import { afterEach, describe, expect, test } from 'vitest';
import type { DatabaseSync as NativeDatabase } from 'node:sqlite';
import { createRequire } from 'node:module';
import { URL as NodeURL } from 'node:url';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { analysisMessages } from './analysis-messages.js';

// Vite 5's builtin list predates node:sqlite; load the Node builtin directly.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const databases: NativeDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const defaults = {lineAccountId:'A',since:'2026-10-20T00:00:00+09:00',until:'2026-10-21T00:00:00+09:00',asOf:'2026-10-22T00:00:00+09:00'};
function fixture() {
  const native = new DatabaseSync(':memory:'); databases.push(native);
  native.exec(`CREATE TABLE friends(id TEXT PRIMARY KEY,line_account_id TEXT,is_following INTEGER);
    CREATE TABLE chats(friend_id TEXT,status TEXT);
    CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,line_account_id TEXT,direction TEXT,message_type TEXT,source TEXT,delivery_type TEXT,created_at TEXT,content TEXT);`);
  const reads: {sql:string;params:unknown[]}[] = [];
  const beforeRead: {run?: (sql:string) => void} = {};
  const db = {prepare(sql:string) {
    expect(sql.trim().startsWith('SELECT ')).toBe(true);
    const statement = {bind(...params:unknown[]) { expect(params.length).toBeLessThanOrEqual(100); return {async all() { reads.push({sql,params}); beforeRead.run?.(sql); return {results:native.prepare(sql).all(...params as (string | number | null)[])}; }}; }};
    return statement;
  }};
  const app = new Hono().route('/',analysisMessages);
  const friend = (id:string,account='A',following=1) => native.prepare('INSERT INTO friends VALUES(?,?,?)').run(id,account,following);
  const message = (id:string,friendId:string,options:Partial<{account:string | null;direction:string;type:string;source:string | null;delivery:string | null;at:string;content:string}> = {}) => {
    const o = {account:'A',direction:'incoming',type:'text',source:null,delivery:null,at:'2026-10-20T12:00:00+09:00',content:'受信内容',...options};
    native.prepare('INSERT INTO messages_log VALUES(?,?,?,?,?,?,?,?,?)').run(id,friendId,o.account,o.direction,o.type,o.source,o.delivery,o.at,o.content);
  };
  const request = async (params:Record<string,string | undefined> = {}) => {
    const query = new URLSearchParams();
    for (const [key,value] of Object.entries({...defaults,...params})) if (value !== undefined) query.set(key,value);
    return app.request('https://synthetic.invalid/api/analysis/messages?'+query,{}, {DB:db});
  };
  return {native,reads,beforeRead,friend,message,request};
}

describe('scoped daily analysis input (real SQLite reads, no mutations or sends)',() => {
  test('paginates more than 200 messages with time ties, stable counts and an exact end cursor',async () => {
    const f=fixture(); f.friend('f');
    for(let i=249;i>=0;i--) f.message(`m${String(i).padStart(3,'0')}`,'f');
    f.message('z-reply','f',{direction:'outgoing',source:'manual',at:'2026-10-21T00:00:00+09:00'});
    const first=await (await f.request()).json() as any;
    expect(first.data.items).toHaveLength(200); expect(first.data.items[0].id).toBe('m000'); expect(first.data.items[199].id).toBe('m199');
    expect(first.data.counts).toEqual({incoming:250,conversations:1,postbackExcluded:0,testExcluded:0}); expect(first.data.total).toBe(251);
    const second=await (await f.request({cursor:first.data.nextCursor})).json() as any;
    expect(second.data.items).toHaveLength(51); expect(second.data.items[0].id).toBe('m200'); expect(second.data.items.at(-1).id).toBe('z-reply');
    expect(second.data.nextCursor).toBeNull(); expect(second.data.counts).toEqual(first.data.counts); expect(second.data.total).toBe(251);
    expect([...first.data.items,...second.data.items].map((r:any)=>r.id)).toEqual([...Array.from({length:250},(_,i)=>`m${String(i).padStart(3,'0')}`),'z-reply']);
    expect((await (await f.request({cursor:first.data.nextCursor})).json() as any).data).toEqual(second.data);
  });

  test('uses half-open normalized input and inclusive asOf, including legacy JST and replied/unfollowed/resolved friends',async () => {
    const f=fixture(); f.friend('f','A',0); f.native.exec("INSERT INTO chats VALUES('f','resolved')");
    f.message('before','f',{at:'2026-10-19T14:59:59.999Z'});
    f.message('start','f',{at:'2026-10-19T15:00:00Z',account:null});
    f.message('legacy','f',{at:'2026-10-20 12:00:00.000',account:null});
    f.message('end','f',{at:'2026-10-20T15:00:00Z'});
    f.message('reply','f',{direction:'outgoing',source:'manual',at:'2026-10-20T15:00:00Z'});
    f.message('notification','f',{direction:'outgoing',source:'booking_reminder',type:'flex',at:'2026-10-22T00:00:00+09:00'});
    f.message('late','f',{direction:'outgoing',at:'2026-10-21T15:00:00.001Z'});
    const res=await f.request(); expect(res.status).toBe(200); const {data}=await res.json() as any;
    expect(data.items.map((r:any)=>r.id)).toEqual(['start','legacy','reply','notification']);
    expect(data.items[0]).toEqual({id:'start',friendId:'f',lineAccountId:'A',direction:'incoming',messageType:'text',source:'unknown',content:'受信内容',createdAt:'2026-10-19T15:00:00.000Z'});
    expect(data.counts.incoming).toBe(2); expect(data.scope).toEqual({lineAccountId:'A',since:'2026-10-19T15:00:00.000Z',until:'2026-10-20T15:00:00.000Z',asOf:'2026-10-21T15:00:00.000Z'});
  });

  test('excludes postback/test/nontext inputs, other accounts and outgoing bodies of friends with no qualifying input',async () => {
    const f=fixture(); for(const id of ['yes','postback','test','image','no-input']) f.friend(id); f.friend('other','B');
    f.message('yes','yes'); f.message('postback','postback',{source:'postback'}); f.message('test','test',{delivery:'test'});
    f.message('both','test',{delivery:'test',source:'postback'}); f.message('image','image',{type:'image'}); f.message('other','other',{account:'B'});
    for(const id of ['yes','postback','test','image','no-input']) f.message('out-'+id,id,{direction:'outgoing',source:null,content:'本文-'+id});
    f.message('test-out','yes',{direction:'outgoing',delivery:'test'});
    const {data}=await (await f.request()).json() as any;
    expect(data.items.map((r:any)=>r.id)).toEqual(['out-yes','yes']);
    expect(data.counts).toEqual({incoming:1,conversations:1,postbackExcluded:2,testExcluded:2});
    const bodyReads=f.reads.filter(r=>r.sql.includes('m.content')); expect(bodyReads).toHaveLength(1);
    expect(bodyReads[0].params).toEqual(['A','out-yes','yes']);
  });

  test.each([{friendAccount:'A',messageAccount:'B'},{friendAccount:'B',messageAccount:'A'}])('fails closed on contradictory account ownership: %j',async ({friendAccount,messageAccount})=>{
    const f=fixture(); f.friend('f',friendAccount); f.message('bad','f',{account:messageAccount});
    const response=await f.request(); expect(response.status).toBe(409); expect((await response.json() as any).error.code).toBe('account_mismatch');
    expect(f.reads.some(r=>r.sql.includes('m.content'))).toBe(false);
  });

  test.each(['broken','2026-02-30T12:00:00Z','2026-10-20T24:00:00Z','2026-10-20T12:00:00+25:00'])('fails closed on invalid scoped DB timestamp %s',async at=>{
    const f=fixture(); f.friend('f'); f.message('bad','f',{at}); expect((await f.request()).status).toBe(422);
  });

  test('rejects scope/cursor drift and data changes instead of skipping or mixing pages',async () => {
    const f=fixture(); f.friend('f'); f.message('a','f'); f.message('b','f');
    const {data}=await (await f.request({limit:'1'})).json() as any;
    expect((await f.request({cursor:data.nextCursor,asOf:'2026-10-21T23:00:00+09:00'})).status).toBe(409);
    expect((await f.request({cursor:'not-cursor'})).status).toBe(400);
    f.message('c','f'); expect((await f.request({cursor:data.nextCursor})).status).toBe(409);
  });

  test('empty scope returns zero counts and no content query',async () => {
    const f=fixture(); f.friend('f'); f.message('out','f',{direction:'outgoing'});
    const {data}=await (await f.request()).json() as any;
    expect(data.items).toEqual([]); expect(data.total).toBe(0); expect(data.nextCursor).toBeNull(); expect(data.counts.incoming).toBe(0);
    expect(f.reads.some(r=>r.sql.includes('m.content'))).toBe(false);
  });

  test.each(['delete','move-account','change-source'])('fails closed on %s between metadata and body reads',async mutation=>{
    const f=fixture(); f.friend('f'); f.message('m','f');
    f.beforeRead.run=sql=>{
      if (!sql.includes('m.content')) return;
      if(mutation==='delete') f.native.exec("DELETE FROM messages_log WHERE id='m'");
      if(mutation==='move-account') f.native.exec("UPDATE friends SET line_account_id='B' WHERE id='f'");
      if(mutation==='change-source') f.native.exec("UPDATE messages_log SET source='postback' WHERE id='m'");
    };
    const response=await f.request(); expect(response.status).toBe(409); expect((await response.json() as any).error.code).toBe('analysis_stream_changed');
  });

  test.each([
    {lineAccountId:undefined},{since:undefined},{until:undefined},{asOf:undefined},{since:'2026-10-20T00:00:00'},
    {since:'2026-02-30T00:00:00Z'},{since:defaults.until},{until:'2026-10-22T00:00:00+09:00'},
    {asOf:'2026-10-20T23:59:59+09:00'},{asOf:'2026-10-22T00:00:01+09:00'},
    {limit:'0'},{limit:'201'},{limit:'1.5'},{limit:'1e2'},{limit:'NaN'},
  ])('rejects invalid input before SQL: %j',async params=>{
    const f=fixture(); expect((await f.request(params)).status).toBe(400); expect(f.reads).toEqual([]);
  });

  test('is mounted behind the existing API authentication middleware; queue route remains independent',()=>{
    const index=readFileSync(new NodeURL('../index.ts',import.meta.url),'utf8');
    expect(index.indexOf("app.use('*', authMiddleware)")).toBeLessThan(index.indexOf("app.route('/', analysisMessages)"));
    expect(index).toContain("app.route('/', conversations)");
  });
});
