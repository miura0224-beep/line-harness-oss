import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{slackCard,verifySignature,deliver,reconcile,flush,messagePayload} from './worker.mjs';
const envConfig={LINE_ACCOUNT_ID:'bridge',ACCOUNT_LABEL:'塾生LINE',CHAT_URL:'https://example.com/chats',HARNESS_WEBHOOK_SECRET:'test-secret',SLACK_WEBHOOK_URL:'https://hooks.slack.com/services/test'};
function db(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE friends(id TEXT PRIMARY KEY,display_name TEXT,line_account_id TEXT); CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,direction TEXT,message_type TEXT,content TEXT,created_at TEXT,line_account_id TEXT);');
 return {sql,prepare(q){let args=[];return {bind(...a){args=a;return this},async first(){return sql.prepare(q).get(...args)||null},async run(){return {meta:sql.prepare(q).run(...args)}},async all(){return {results:sql.prepare(q).all(...args)}}}}};
}
const payload={event:'message_received',timestamp:'2026-09-16T21:00:00+09:00',data:{friendId:'f1',eventData:{text:'テスト <!channel>'}}};
async function signed(p){
 const raw=JSON.stringify(p),key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('hex');
 return new Request('https://test/notify',{method:'POST',headers:{'x-webhook-signature':sig},body:raw});
}
test('sender, Japanese time, safe text, direct reply button, long messages',()=>{
 const b=slackCard(payload,{display_name:'みうらゆうき <!here>'},envConfig);
 assert.match(b.blocks[1].text.text,/みうらゆうき/);
 assert.match(b.blocks[1].text.text,/21:00:00/);
 assert.equal(b.blocks[2].text.type,'plain_text');
 assert.equal(b.blocks.at(-1).elements[0].text.text,'個別チャットで返信する');
 assert.equal(new URL(b.blocks.at(-1).elements[0].url).searchParams.get('friend'),'f1');
 const long=slackCard({...payload,data:{...payload.data,eventData:{text:'あ'.repeat(12000)}}},{},envConfig);
 assert.ok(long.blocks.every(x=>!x.text||x.text.text.length<=3000));
});
test('invalid signature rejected before database access',async()=>{
 const r=await worker.fetch(new Request('https://test/notify',{method:'POST',body:'{}'}),envConfig);
 assert.equal(r.status,401);
 assert.equal(await verifySignature('{}','0'.repeat(64),'test-secret'),false);
});
test('other account cannot be forwarded',async()=>{
 const DB=db();DB.sql.exec("INSERT INTO friends VALUES('f1','テスト','other')");
 const r=await worker.fetch(await signed(payload),{...envConfig,DB});
 assert.deepEqual(await r.json(),{skipped:'other-account'});
 assert.equal(DB.sql.prepare('SELECT count(*) AS n FROM bridge_slack_deliveries').get().n,0);
});
test('database reconciliation recovers all message types, isolates accounts and never resends',async()=>{
 const DB=db();
 DB.sql.exec("INSERT INTO friends VALUES('f1','みうらゆうき','bridge'),('f2','他アカウント','other')");
 const insert=DB.sql.prepare('INSERT INTO messages_log VALUES(?,?,?,?,?,?,?)');
 insert.run('text1','f1','incoming','text','問い合わせ','2026-09-16T21:00:00+09:00',null);
 insert.run('image1','f1','incoming','image','{}','2026-09-16T21:01:00+09:00',null);
 insert.run('file1','f1','incoming','file','[ファイル: 答案.pdf]','2026-09-16T21:02:00+09:00','bridge');
 insert.run('other','f2','incoming','text','混ぜない','2026-09-16T21:00:00+09:00','other');
 insert.run('wrong','f1','incoming','text','明示的に別アカウント','2026-09-16T21:00:00+09:00','other');
 insert.run('out','f1','outgoing','text','返信','2026-09-16T21:00:00+09:00','bridge');
 const env={...envConfig,DB,BACKFILL_BEFORE:'2026-09-21T00:00:00+09:00'};
 assert.equal(await reconcile(env),3);
 assert.equal(await reconcile(env),0);
 let cards=[];
 assert.equal(await flush(env,async(_u,opt)=>{cards.push(JSON.parse(opt.body));return new Response('ok')},async()=>{}),3);
 assert.equal(cards.length,3);
 assert.match(cards[0].blocks[2].text.text,/問い合わせ/);
 assert.match(cards[1].blocks[2].text.text,/画像/);
 assert.match(cards[2].blocks[2].text.text,/答案.pdf/);
 assert.match(cards[0].blocks.at(-2).elements[0].text,/過去の未通知分/);
 assert.equal(await reconcile(env),0);
 const hints=[payload,{...payload,timestamp:'2026-09-21T00:00:00+09:00'}];
 for(const hint of hints) assert.deepEqual(await (await worker.fetch(await signed(hint),env)).json(),{queued:0});
 assert.equal(await flush(env,async()=>{throw Error('duplicate')},async()=>{}),0);
 assert.equal(DB.sql.prepare('SELECT count(*) n FROM bridge_slack_deliveries WHERE payload IS NOT NULL').get().n,0);
 // A new message is found even if no outgoing webhook fired.
 insert.run('late','f1','incoming','sticker','{}','2026-09-21T22:00:00+09:00','bridge');
 assert.equal(await reconcile(env),1);
 assert.equal(messagePayload({content:'{}',message_type:'sticker',created_at:'2026-09-21T22:00:00+09:00'},env).backfill,false);
});
test('legacy JST timestamps are not interpreted as UTC',()=>{
 const card=slackCard({...payload,timestamp:'2026-09-16T21:00:00'},{},envConfig);
 assert.match(card.blocks[1].text.text,/21:00:00/);
});
test('Slack failure remains queued, retry succeeds and suppresses another delivery',async()=>{
 const DB=db();DB.sql.exec("INSERT INTO bridge_slack_deliveries(event_key,payload,updated_at) VALUES('k','{}',0)");
 const env={...envConfig,DB};
 assert.deepEqual(await deliver(env,'k',async()=>new Response('error',{status:429})),{queued:true});
 assert.equal(DB.sql.prepare("SELECT status FROM bridge_slack_deliveries").get().status,'pending');
 DB.sql.exec('UPDATE bridge_slack_deliveries SET next_attempt=0');
 assert.deepEqual(await deliver(env,'k',async()=>new Response('ok')),{sent:true});
 assert.deepEqual(await deliver(env,'k',async()=>{throw Error('should not send')}),{skipped:'already-claimed'});
});
