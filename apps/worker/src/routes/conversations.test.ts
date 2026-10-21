import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { conversations } from './conversations.js';

describe('GET /api/conversations D1 binding limit', () => {
  test.each([0, 1, 100, 101, 150, 200])('returns all %i friends with their tags', async (size) => {
    const friends = Array.from({ length: size }, (_, i) => ({
      friend_id: `friend-${i}`, hours_since: i, last_incoming_at: '2026-10-20T12:00:00+09:00',
    }));
    const chunks: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        let params: unknown[] = [];
        const stmt = {
          bind(...values: unknown[]) {
            if (values.length > 100) throw new Error('D1_ERROR: too many SQL variables');
            params = values;
            return stmt;
          },
          async first() { return { total: size + 42 }; },
          async all() {
            if (!sql.includes('FROM friend_tags')) return { results: friends };
            chunks.push(params);
            // Untagged friend, multiple tags, and deliberately reversed DB order.
            return { results: params.flatMap(id => id === 'friend-0' ? [] : [
              { friend_id: id, name: `tag:${id}` }, { friend_id: id, name: 'shared' },
            ]).reverse() };
          },
        };
        return stmt;
      },
    };
    const app = new Hono(); app.route('/', conversations);
    const response = await app.request('http://worker.test/api/conversations?limit=200&offset=20&lineAccountId=account&maxHoursSince=72', {}, { DB: db } as never);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { total: number; items: { friendId: string; tags: string[] }[] } };
    expect(body.data.total).toBe(size + 42);
    expect(body.data.items.map(x => x.friendId)).toEqual(friends.map(x => x.friend_id));
    expect(chunks.flat()).toEqual(friends.map(x => x.friend_id));
    expect(chunks.length).toBe(Math.ceil(size / 100));
    body.data.items.forEach((item, i) => expect(item.tags.sort()).toEqual(i === 0 ? [] : ['shared', `tag:friend-${i}`].sort()));
  });
  test('fails explicitly if a later tag chunk fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const db = { prepare(sql: string) {
      const stmt = { bind(...values: unknown[]) { return stmt; }, async first() { return { total: 101 }; }, async all() {
        if (!sql.includes('FROM friend_tags')) return { results: Array.from({ length: 101 }, (_, i) => ({ friend_id: String(i) })) };
        if (++calls === 2) throw new Error('D1 unavailable');
        return { results: [] };
      } }; return stmt;
    } };
    try {
      const app = new Hono(); app.route('/', conversations);
      const response = await app.request('http://worker.test/api/conversations?limit=200', {}, { DB: db } as never);
      expect(response.status).toBe(500);
      expect((await response.json() as { success: boolean }).success).toBe(false);
    } finally { log.mockRestore(); }
  });
});
