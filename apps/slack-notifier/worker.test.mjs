import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{chatMessage,chatBody,verifySignature,deliver,reconcile,flush,messagePayload} from './worker.mjs';
const accepted=()=>Response.json({name:'spaces/TEST/messages/1'});
const envConfig={LINE_ACCOUNT_ID:'bridge',ACCOUNT_LABEL:'塾生LINE',CHAT_URL:'https://example.com/chats',HARNESS_WEBHOOK_SECRET:'test-secret',GOOGLE_CHAT_WEBHOOK_URL:'https://chat.googleapis.com/v1/spaces/TEST/messages?key=k&token=t'};
function db(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE friends(id TEXT PRIMARY KEY,display_name TEXT,line_account_id TEXT); CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,direction TEXT,message_type TEXT,content TEXT,created_at TEXT,line_account_id TEXT);');
 return {sql,prepare(q){let args=[];return {bind(...a){args=a;return this},async first(){return sql.prepare(q).get(...args)||null},async run(){return {meta:sql.prepare(q).run(...args)}},async all(){return {results:sql.prepare(q).all(...args)}}}}};
}
const payload={event:'message_received',timestamp:'2026-09-16T21:00:00+09:00',data:{friendId:'f1',eventData:{text:'テスト <users/all>'}}};
async function signed(p){
 const raw=JSON.stringify(p),key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('hex');
 return new Request('https://test/notify',{method:'POST',headers:{'x-webhook-signature':sig},body:raw});
}
test('sender, Japanese time, no mentions from user text, direct reply link, long messages',()=>{
 const m=chatMessage(payload,{display_name:'みうらゆうき <users/all>'},envConfig);
 assert.deepEqual(Object.keys(m),['text']);
 assert.match(m.text,/送信者：みうらゆうき/);
 assert.match(m.text,/21:00:00/);
 assert.match(m.text,/塾生LINEに新着メッセージ/);
 assert.ok(!m.text.includes('<users/all>'));
 assert.equal(m.text.match(/</g).length,1);
 assert.match(m.text,/<https:\/\/example\.com\/chats\?friend=f1\|個別チャットで返信する>$/);
 const long=chatMessage({...payload,data:{...payload.data,eventData:{text:'あ'.repeat(12000)}}},{},envConfig);
 assert.ok(long.text.length<=4000);
 assert.match(long.text,/続きは個別チャットで確認できます/);
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
 assert.equal(await flush(env,async(_u,opt)=>{cards.push(JSON.parse(opt.body));return accepted()},async()=>{}),3);
 assert.equal(cards.length,3);
 assert.match(cards[0].text,/問い合わせ/);
 assert.match(cards[1].text,/画像/);
 assert.match(cards[2].text,/答案.pdf/);
 assert.match(cards[0].text,/過去の未通知分/);
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
 const card=chatMessage({...payload,timestamp:'2026-09-16T21:00:00'},{},envConfig);
 assert.match(card.text,/21:00:00/);
});
test('Google Chat failure remains queued, retry succeeds and suppresses another delivery',async()=>{
 const DB=db();DB.sql.exec("INSERT INTO bridge_slack_deliveries(event_key,payload,updated_at) VALUES('k','{\"text\":\"x\"}',0)");
 const env={...envConfig,DB};
 assert.deepEqual(await deliver(env,'k',async()=>new Response('error',{status:429})),{queued:true});
 assert.equal(DB.sql.prepare("SELECT status FROM bridge_slack_deliveries").get().status,'pending');
 DB.sql.exec('UPDATE bridge_slack_deliveries SET next_attempt=0');
 // A bare "ok" (Slack's reply) is not a Google Chat acceptance.
 assert.deepEqual(await deliver(env,'k',async()=>new Response('ok')),{queued:true});
 DB.sql.exec('UPDATE bridge_slack_deliveries SET next_attempt=0');
 assert.deepEqual(await deliver(env,'k',accepted),{sent:true});
 assert.deepEqual(await deliver(env,'k',async()=>{throw Error('should not send')}),{skipped:'already-claimed'});
});
test('only a Google Chat space webhook is accepted as destination',async()=>{
 for(const url of ['https://hooks.slack.com/services/test','http://chat.googleapis.com/v1/spaces/T/messages','https://chat.googleapis.com.evil.example/v1/spaces/T/messages','https://chat.googleapis.com/v1/other',undefined]){
  const DB=db();DB.sql.exec("INSERT INTO bridge_slack_deliveries(event_key,payload,updated_at) VALUES('k','{\"text\":\"x\"}',0)");
  let called=false;
  assert.deepEqual(await deliver({...envConfig,GOOGLE_CHAT_WEBHOOK_URL:url,DB},'k',async()=>{called=true;return accepted()}),{queued:true});
  assert.equal(called,false);
 }
});
test('a Slack card queued before the move is sent as the same content in text',()=>{
 const old=JSON.stringify({username:'x',text:'y',blocks:[
  {type:'header',text:{type:'plain_text',text:'📩 塾生LINEに新着メッセージ'}},
  {type:'section',text:{type:'plain_text',text:'送信者：テスト <users/all>\n受信日時：2026/9/16 21:00:00'}},
  {type:'section',text:{type:'plain_text',text:'本文です'}},
  {type:'context',elements:[{type:'plain_text',text:'通知復旧に伴う過去の未通知分です。'}]},
  {type:'actions',elements:[{type:'button',url:'https://example.com/chats?friend=f1'}]}]});
 const body=JSON.parse(chatBody(old));
 assert.deepEqual(Object.keys(body),['text']);
 assert.match(body.text,/\*塾生LINEに新着メッセージ\*/);
 assert.match(body.text,/本文です/);
 assert.match(body.text,/過去の未通知分/);
 assert.ok(!body.text.includes('<users/all>'));
 assert.match(body.text,/<https:\/\/example\.com\/chats\?friend=f1\|個別チャットで返信する>$/);
 assert.equal(chatBody('{"text":"x"}'),'{"text":"x"}');
});
