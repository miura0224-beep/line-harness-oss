import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
import { upsertFriend, getFriendByLineUserId, getFriendByLineUserIdForAccount, updateFriendFollowStatus } from '../src/friends';
function fixture() {
 const sql = new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE friends(id TEXT PRIMARY KEY,line_user_id TEXT NOT NULL,line_account_id TEXT,display_name TEXT,picture_url TEXT,status_message TEXT,is_following INTEGER DEFAULT 1,first_followed_at TEXT,current_follow_started_at TEXT,last_followed_at TEXT,last_unfollowed_at TEXT,unfollow_count INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT,UNIQUE(line_user_id,line_account_id))`);
 return {sql,db:{prepare(q:string){let args:any[]=[];return {bind(...a:any[]){args=a;return this},async first(){return sql.prepare(q).get(...args)||null},async run(){return sql.prepare(q).run(...args)},async all(){return {results:sql.prepare(q).all(...args)}}}}} as any};
}
describe('account-scoped LINE identity',()=>{
 it('same user in two accounts has isolated friend ids and profile/follow changes',async()=>{
  const {db}=fixture();
  const a=await upsertFriend(db,{lineUserId:'Uone',lineAccountId:'A',displayName:'A name'});
  const b=await upsertFriend(db,{lineUserId:'Uone',lineAccountId:'B',displayName:'B name'});
  expect(a.id).not.toBe(b.id);
  await upsertFriend(db,{lineUserId:'Uone',lineAccountId:'A',displayName:'Updated'});
  expect((await getFriendByLineUserIdForAccount(db,'Uone','B'))?.display_name).toBe('B name');
  await updateFriendFollowStatus(db,'Uone',false,'A');
  expect((await getFriendByLineUserIdForAccount(db,'Uone','A'))?.is_following).toBe(0);
  expect((await getFriendByLineUserIdForAccount(db,'Uone','B'))?.is_following).toBe(1);
 });
 it('unknown account never falls back to another account; unscoped ambiguous identity fails closed',async()=>{
  const {db}=fixture();
  await upsertFriend(db,{lineUserId:'Uone',lineAccountId:'A'});
  expect(await getFriendByLineUserIdForAccount(db,'Uone','B')).toBeNull();
  await upsertFriend(db,{lineUserId:'Uone',lineAccountId:'B'});
  expect(await getFriendByLineUserId(db,'Uone')).toBeNull();
 });
 it('repeated events preserve friend id and account',async()=>{
  const {db,sql}=fixture();
  const a=await upsertFriend(db,{lineUserId:'Uone',lineAccountId:'A'});
  const b=await upsertFriend(db,{lineUserId:'Uone',lineAccountId:'A'});
  expect(a.id).toBe(b.id);
  expect(sql.prepare('SELECT COUNT(*) AS n FROM friends').get().n).toBe(1);
 });
});
