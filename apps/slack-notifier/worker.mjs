// Adapted from threestars-cs/src/line-inquiry-slack.mjs.
// Database reconciliation -> durable message-ID outbox -> Google Chat message.
// The outbox table keeps its original name (bridge_slack_deliveries): its sent keys are what
// prevent old messages from being posted again.
// Signed events are wake-up hints; cron also discovers messages without events.
// User-supplied text never becomes a mention or link: angle brackets are widened.
const plain=value=>String(value).replace(/</g,'＜').replace(/>/g,'＞');
export function chatMessage(payload, friend, env) {
  const name = plain(String(friend.display_name || '名前未取得').slice(0, 200));
  const text = String(payload.data.eventData.text);
  const time = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(payload.timestamp) ? payload.timestamp : payload.timestamp+'+09:00');
  const received = Number.isNaN(time.valueOf()) ? '未取得' : time.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',hour12:false});
  const url = new URL(env.CHAT_URL);
  url.searchParams.set('friend',payload.data.friendId);
  const lines = ['📩 *'+env.ACCOUNT_LABEL+'に新着メッセージ*','送信者：'+name,'受信日時：'+received,'',plain(text.slice(0,3000))];
  if(text.length>3000) lines.push('（続きは個別チャットで確認できます）');
  if (payload.backfill) lines.push('','通知復旧に伴う過去の未通知分です。上記は元の受信日時です。');
  lines.push('','<'+url.href+'|個別チャットで返信する>');
  return {text:lines.join('\n')};
}
// Rows queued before the move to Google Chat hold a Slack card; send the same content as text.
export function chatBody(stored) {
  let card;try{card=JSON.parse(stored);}catch{return stored;}
  if(!Array.isArray(card?.blocks)) return stored;
  const lines=[];
  for(const block of card.blocks){
    if(block.type==='header') lines.push('📩 *'+String(block.text.text).replace(/^📩\s*/,'')+'*');
    else if(block.type==='section') lines.push(plain(block.text.text));
    else if(block.type==='context') lines.push('',...block.elements.map(x=>plain(x.text)));
    else if(block.type==='actions') lines.push('','<'+block.elements[0].url+'|個別チャットで返信する>');
  }
  return JSON.stringify({text:lines.join('\n').slice(0,4000)});
}
// Each account keeps its own outbox table; the name comes from configuration, never from a request.
export function table(env) {
  const name=env.OUTBOX_TABLE||'bridge_slack_deliveries';
  if(!/^[a-z_]{1,40}$/.test(name)) throw Error('Invalid outbox table');
  return name;
}
const ready=new Set();
async function ensureTable(env) {
  const name=table(env);
  if(ready.has(name)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS "+name+" (event_key TEXT PRIMARY KEY,payload TEXT,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL)").run();
  ready.add(name);
}
export async function verifySignature(raw, signature, secret) {
  if(!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode(raw));
}
export async function deliver(env, key, post=fetch) {
  const now=Date.now();
  const job=await env.DB.prepare("UPDATE "+table(env)+" SET status='sending',attempts=attempts+1,next_attempt=?,updated_at=? WHERE event_key=? AND status IN ('pending','sending') AND next_attempt<=? RETURNING *").bind(now+120000,now,key,now).first();
  if(!job) return {skipped:'already-claimed'};
  try {
    const target=new URL(env.GOOGLE_CHAT_WEBHOOK_URL);
    if(target.protocol!=='https:' || target.hostname!=='chat.googleapis.com' || !/^\/v1\/spaces\/[^/]+\/messages$/.test(target.pathname)) throw Error('Invalid destination');
    const res=await post(target.href,{method:'POST',headers:{'content-type':'application/json; charset=UTF-8'},body:chatBody(job.payload),signal:AbortSignal.timeout(10000)});
    if(!res.ok || !(await res.json().catch(()=>null))?.name) throw Error('Google Chat rejected delivery');
    await env.DB.prepare("UPDATE "+table(env)+" SET status='sent',payload=NULL,updated_at=? WHERE event_key=?").bind(Date.now(),key).run();
    return {sent:true};
  } catch {
    await env.DB.prepare("UPDATE "+table(env)+" SET status=?,next_attempt=?,updated_at=? WHERE event_key=?").bind('pending',Date.now()+Math.min(3600000,60000*2**Math.min(job.attempts,6)),Date.now(),key).run();
    console.error(JSON.stringify({event:'chat_delivery_failed',key,attempt:job.attempts}));
    return {queued:true};
  }
}
export function messagePayload(row, env) {
  let text = row.content;
  if (row.message_type !== 'text') {
    const labels = {image:'画像',file:'ファイル',sticker:'スタンプ',video:'動画',audio:'音声',location:'位置情報'};
    const label = labels[row.message_type] || row.message_type;
    try {
      const content = JSON.parse(row.content);
      text = '['+label+']'+(content.fileName ? ' '+content.fileName : '')+'\n添付内容は個別チャットで確認してください。';
    } catch {
      text = row.content || '['+label+']';
    }
  }
  return {event:'message_received',timestamp:row.created_at,
    backfill: Boolean(env.BACKFILL_BEFORE && row.created_at < env.BACKFILL_BEFORE),
    data:{friendId:row.friend_id,eventData:{text}}};
}
export async function reconcile(env) {
  // Keep message-ID receipts permanently: pruning would replay old messages.
  // Explicit message ownership wins; legacy incoming records have only friend ownership.
  await ensureTable(env);
  // ONLY_NON_TEXT: text is already notified elsewhere, so only attachments, stickers etc. are picked up.
  // START_AFTER: a newly added account starts from this time instead of replaying its whole history.
  const rows=await env.DB.prepare(`SELECT m.id,m.friend_id,m.message_type,m.content,m.created_at,f.display_name
    FROM messages_log m JOIN friends f ON f.id=m.friend_id
    WHERE m.direction='incoming' AND f.line_account_id=?
      AND (m.line_account_id IS NULL OR m.line_account_id=?)
      ${env.ONLY_NON_TEXT==='1' ? "AND m.message_type!='text'" : ''}
      AND m.created_at>=?
      AND NOT EXISTS (SELECT 1 FROM ${table(env)} d WHERE d.event_key='message:'||m.id)
    ORDER BY m.created_at,m.id LIMIT 100`).bind(env.LINE_ACCOUNT_ID,env.LINE_ACCOUNT_ID,env.START_AFTER||'').all();
  for (const row of rows.results) {
    await env.DB.prepare("INSERT OR IGNORE INTO "+table(env)+"(event_key,payload,updated_at) VALUES (?,?,?)")
      .bind('message:'+row.id,JSON.stringify(chatMessage(messagePayload(row,env),row,env)),Date.now()).run();
  }
  return rows.results.length;
}
export async function flush(env, post=fetch, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  const jobs=await env.DB.prepare("SELECT event_key FROM "+table(env)+" WHERE status IN ('pending','sending') AND next_attempt<=? ORDER BY updated_at,rowid LIMIT 30").bind(Date.now()).all();
  let sent=0;
  for(const job of jobs.results) {
    const result=await deliver(env,job.event_key,post);
    if(result.sent) sent++;
    // One shared space; Google Chat allows about one webhook message per second per space.
    await pause(1100);
  }
  return sent;
}
export default {
  async fetch(request,env) {
    if(new URL(request.url).pathname!=='/notify' || request.method!=='POST') return new Response('Not found',{status:404});
    if(Number(request.headers.get('content-length'))>65536) return new Response('Too large',{status:413});
    const reader=request.body?.getReader();
    if(!reader) return new Response('Missing body',{status:400});
    let bytes=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536){await reader.cancel();return new Response('Too large',{status:413});}chunks.push(value);}
    const raw=await new Blob(chunks).text();
    if(!await verifySignature(raw,request.headers.get('x-webhook-signature'),env.HARNESS_WEBHOOK_SECRET)) return new Response('Unauthorized',{status:401});
    let p;try{p=JSON.parse(raw);}catch{return new Response('Invalid JSON',{status:400});}
    if(p?.event!=='message_received'||typeof p?.data?.friendId!=='string') return Response.json({skipped:'not-message'});
    const friend=await env.DB.prepare('SELECT id,display_name,line_account_id FROM friends WHERE id=?').bind(p.data.friendId).first();
    if(!friend||friend.line_account_id!==env.LINE_ACCOUNT_ID) return Response.json({skipped:'other-account'});
    // Never use request text as truth or hash a dispatch timestamp for deduplication.
    return Response.json({queued:await reconcile(env)});
  },
  async scheduled(_event,env,ctx) {
    ctx.waitUntil((async()=>{
      const queued=await reconcile(env);
      const sent=await flush(env);
      const failed=await env.DB.prepare("SELECT count(*) AS n FROM "+table(env)+" WHERE status='failed'").first();
      console.log(JSON.stringify({event:'bridge_chat_reconciliation',queued,sent,failed:failed.n}));
    })());
  }
};
