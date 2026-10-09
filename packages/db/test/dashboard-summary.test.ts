import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { getChatSummary } from '../src/chat-summary';

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE chats (id TEXT PRIMARY KEY, friend_id TEXT, status TEXT, created_at TEXT);`);
  const db = { prepare(sql: string) {
    let values: (string | number | null)[] = [];
    return { bind(...params: (string | number | null)[]) { values = params; return this; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
  } };
  return { sqlite, summary: (accountId?: string) => getChatSummary(db as unknown as D1Database, accountId) };
}

describe('dashboard chat totals', () => {
  test('counts beyond a list page, isolates accounts, excludes implicit resolved and deduplicates old chats', async () => {
    const { sqlite, summary } = setup();
    for (let i = 0; i < 350; i++) {
      sqlite.prepare('INSERT INTO friends VALUES (?, ?)').run(`f${i}`, 'account-a');
      sqlite.prepare('INSERT INTO chats VALUES (?, ?, ?, ?)').run(`c${i}`, `f${i}`, 'resolved', '2026-09-08');
    }
    sqlite.exec(`INSERT INTO friends VALUES ('unhandled', 'account-a'), ('other', 'account-b');
      INSERT INTO chats VALUES ('other-c', 'other', 'unread', '2026-09-08');
      INSERT INTO chats VALUES ('old', 'f0', 'unread', '2026-09-01');`);
    expect(await summary('account-a')).toEqual({ unread: 0, inProgress: 0, resolved: 350 });
    expect(await summary('account-b')).toEqual({ unread: 1, inProgress: 0, resolved: 0 });
    expect(await summary()).toEqual({ unread: 1, inProgress: 0, resolved: 350 });
    sqlite.close();
  });
  test('empty account has zero counts and treats account input as a value', async () => {
    const { sqlite, summary } = setup();
    expect(await summary("x' OR 1=1 --")).toEqual({ unread: 0, inProgress: 0, resolved: 0 });
    sqlite.close();
  });
});
