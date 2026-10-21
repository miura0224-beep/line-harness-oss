import { Hono } from 'hono';
import type { Env } from '../index.js';

const analysisMessages = new Hono<Env>();
const DAY = 24 * 60 * 60 * 1000;
class AnalysisError extends Error {
  status: 400 | 409 | 422;
  code: string;
  constructor(status: 400 | 409 | 422, code: string, message: string) { super(message); this.status=status; this.code=code; }
}

// Do not let Date.parse silently repair invalid calendar dates. Inputs require an
// explicit offset; legacy DB values without one follow the existing JST convention.
function timestamp(value: unknown, legacy = false): number {
  if (typeof value !== 'string') throw new Error('Timestamp must be a string');
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || (!legacy && (!match[8] || value[10] !== 'T'))) throw new Error('Expected an ISO datetime with an explicit offset');
  const [, y, mo, d, h, mi, s, fraction = '', zone] = match;
  const calendar = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (calendar.getUTCFullYear() !== Number(y) || calendar.getUTCMonth() + 1 !== Number(mo) || calendar.getUTCDate() !== Number(d)
    || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59
    || (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) throw new Error('Invalid datetime');
  const result = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${fraction}${zone ?? '+09:00'}`);
  if (!Number.isFinite(result)) throw new Error('Invalid datetime');
  return result;
}

type Metadata = {
  id: string; friend_id: string; canonical_account: string | null; line_account_id: string | null;
  direction: string; message_type: string; source: string | null; delivery_type: string | null; created_at: string;
};
const META = 'm.id,m.friend_id,f.line_account_id AS canonical_account,m.line_account_id,m.direction,m.message_type,m.source,m.delivery_type,m.created_at';
const fingerprint = (row: Metadata) => [row.id,row.friend_id,row.canonical_account,row.line_account_id,row.direction,row.message_type,row.source,row.delivery_type,row.created_at];
type Cursor = { v: number; scope: string; snapshot: string; time: number; id: string };
const encodeCursor = (cursor: Cursor) => btoa(encodeURIComponent(JSON.stringify(cursor))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function decodeCursor(value: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4000) throw Error();
    const cursor = JSON.parse(decodeURIComponent(atob(value.replaceAll('-', '+').replaceAll('_', '/'))));
    if (cursor.v !== 1 || typeof cursor.scope !== 'string' || typeof cursor.snapshot !== 'string'
      || !Number.isSafeInteger(cursor.time) || typeof cursor.id !== 'string') throw Error();
    return cursor;
  } catch { throw new AnalysisError(400, 'invalid_cursor', 'Invalid analysis cursor'); }
}

analysisMessages.get('/api/analysis/messages', async (c) => {
  try {
    const query = new URL(c.req.url).searchParams;
    for (const name of ['lineAccountId','since','until','asOf','limit','cursor']) {
      if (query.getAll(name).length > 1) throw new AnalysisError(400, 'invalid_scope', `Repeated parameter: ${name}`);
    }
    const account = query.get('lineAccountId');
    if (!account || account.trim() !== account || account.length > 200) throw new AnalysisError(400, 'invalid_scope', 'lineAccountId is required');
    let since: number, until: number, asOf: number;
    try { since = timestamp(query.get('since')); until = timestamp(query.get('until')); asOf = timestamp(query.get('asOf')); }
    catch (e) { throw new AnalysisError(400, 'invalid_scope', String((e as Error).message)); }
    if (!(since < until && until <= asOf) || until - since > DAY || asOf - until > DAY) throw new AnalysisError(400, 'invalid_scope', 'Require since < until <= asOf, with input and lookahead at most 24 hours each');
    const rawLimit = query.get('limit') ?? '200';
    if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 200) throw new AnalysisError(400, 'invalid_limit', 'limit must be an integer from 1 to 200');
    const limit = Number(rawLimit);
    const scope = {lineAccountId:account,since:new Date(since).toISOString(),until:new Date(until).toISOString(),asOf:new Date(asOf).toISOString()};
    const scopeKey = JSON.stringify(scope);
    const cursor = query.has('cursor') ? decodeCursor(query.get('cursor')!) : null;
    if (cursor && cursor.scope !== scopeKey) throw new AnalysisError(409, 'cursor_scope_changed', 'Cursor belongs to a different analysis scope');
    const {results: accounts} = await c.env.DB.prepare('SELECT id,is_active FROM line_accounts WHERE id=?').bind(account).all<{id:string;is_active:number}>();
    if (!accounts[0] || accounts[0].is_active !== 1) throw new AnalysisError(409,'unknown_account','Analysis requires an existing active account');

    // Metadata only: do not retrieve unrelated friends' outgoing bodies. Include
    // rows claiming this account as well, so contradictory ownership fails closed.
    // Prune valid historical rows in SQL before transferring metadata to the
    // Worker. One-second guard bands avoid floating-point boundary loss; JS
    // still makes the exact millisecond decisions below. Undatable rows remain
    // an explicit error because they cannot safely be declared outside scope.
    const sqlTime = `julianday(CASE WHEN substr(m.created_at,-1) IN ('Z','z') OR substr(m.created_at,-6,1) IN ('+','-') THEN m.created_at ELSE m.created_at||'+09:00' END)`;
    const calendar = `date(substr(m.created_at,1,10),'+0 days')`;
    const {results: metadata} = await c.env.DB.prepare(`SELECT ${META} FROM messages_log m LEFT JOIN friends f ON f.id=m.friend_id WHERE (f.line_account_id=? OR m.line_account_id=?) AND (${sqlTime} IS NULL OR ${calendar} IS NULL OR ${calendar}!=substr(m.created_at,1,10) OR (${sqlTime}>=julianday(?) - 1.0/86400 AND ${sqlTime}<=julianday(?) + 1.0/86400))`).bind(account,account,scope.since,scope.asOf).all<Metadata>();
    const normalized = metadata.map(row => {
      if (row.canonical_account !== account || (row.line_account_id !== null && row.line_account_id !== account)) throw new AnalysisError(409, 'account_mismatch', `Message account conflicts with friend ownership: ${row.id}`);
      let time: number;
      try { time = timestamp(row.created_at, true); }
      catch { throw new AnalysisError(422, 'invalid_message_timestamp', `Invalid message timestamp: ${row.id}`); }
      return {row,time};
    });
    const candidates = normalized.filter(({row,time}) => row.direction === 'incoming' && row.message_type === 'text' && time >= since && time < until);
    const incoming = candidates.filter(({row}) => row.source !== 'postback' && row.delivery_type !== 'test');
    const friends = new Set(incoming.map(({row}) => row.friend_id));
    const incomingIds = new Set(incoming.map(({row}) => row.id));
    const stream = normalized.filter(({row,time}) => incomingIds.has(row.id) || (friends.has(row.friend_id) && row.direction === 'outgoing' && row.delivery_type !== 'test' && row.source !== 'postback' && time >= since && time <= asOf))
      .sort((a,b) => a.time - b.time || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
    const counts = {incoming:incoming.length,conversations:friends.size,postbackExcluded:candidates.filter(({row}) => row.source === 'postback').length,testExcluded:candidates.filter(({row}) => row.delivery_type === 'test').length};
    const bytes = new TextEncoder().encode(JSON.stringify({counts,stream:stream.map(({row,time}) => [time,...fingerprint(row)])}));
    const snapshot = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('');
    let start = 0;
    if (cursor) {
      if (cursor.snapshot !== snapshot) throw new AnalysisError(409, 'analysis_stream_changed', 'Analysis stream changed; restart pagination');
      const anchor = stream.findIndex(({row,time}) => row.id === cursor.id && time === cursor.time);
      if (anchor < 0) throw new AnalysisError(400, 'invalid_cursor', 'Cursor anchor is absent');
      start = anchor + 1;
    }
    const page = stream.slice(start,start + limit);
    const bodies = new Map<string, string>();
    for (let i = 0; i < page.length; i += 98) {
      const chunk = page.slice(i,i + 98), ids = chunk.map(({row}) => row.id);
      const {results} = await c.env.DB.prepare(`SELECT ${META},m.content FROM messages_log m JOIN friends f ON f.id=m.friend_id WHERE f.line_account_id=? AND m.id IN (${ids.map(() => '?').join(',')})`).bind(account,...ids).all<Metadata & {content:string}>();
      for (const row of results) {
        const expected = chunk.find(item => item.row.id === row.id)!.row;
        if (JSON.stringify(fingerprint(row)) !== JSON.stringify(fingerprint(expected))) throw new AnalysisError(409, 'analysis_stream_changed', 'Message changed during analysis read');
        if (typeof row.content !== 'string') throw new AnalysisError(422, 'invalid_message_content', `Invalid message content: ${row.id}`);
        bodies.set(row.id,row.content);
      }
      if (results.length !== chunk.length) throw new AnalysisError(409, 'analysis_stream_changed', 'Messages disappeared during analysis read');
    }
    const items = page.map(({row,time}) => ({id:row.id,friendId:row.friend_id,lineAccountId:account,direction:row.direction,messageType:row.message_type,source:row.source ?? 'unknown',content:bodies.get(row.id)!,createdAt:new Date(time).toISOString()}));
    const last = page.at(-1);
    const nextCursor = last && start + page.length < stream.length ? encodeCursor({v:1,scope:scopeKey,snapshot,time:last.time,id:last.row.id}) : null;
    return c.json({data:{items,total:stream.length,nextCursor,counts,scope}});
  } catch (e) {
    if (e instanceof AnalysisError) return c.json({error:{code:e.code,message:e.message}},e.status);
    console.error('Analysis messages read failed',e);
    return c.json({error:{code:'analysis_read_failed',message:'Unable to read analysis messages'}},500);
  }
});

export { analysisMessages };
