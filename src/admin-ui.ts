// 管理画面（単一HTML、外部依存なし）。認証はADMIN_API_KEYをsessionStorageに保持しBearerで送信。
export const ADMIN_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LINE Harness 管理画面</title>
<style>
:root { --bg:#f5f6f8; --card:#fff; --text:#1a202c; --sub:#64748b; --line:#e2e8f0; --accent:#06c755; --danger:#dc2626; }
* { box-sizing:border-box; margin:0; }
body { font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif; background:var(--bg); color:var(--text); }
header { background:var(--card); border-bottom:1px solid var(--line); padding:12px 20px; display:flex; align-items:center; gap:16px; }
header h1 { font-size:16px; }
header .spacer { flex:1; }
nav button { background:none; border:none; padding:8px 12px; font-size:14px; cursor:pointer; color:var(--sub); border-radius:6px; }
nav button.active { background:#e6f9ee; color:var(--accent); font-weight:600; }
main { max-width:960px; margin:24px auto; padding:0 16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:20px; margin-bottom:16px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--sub); font-weight:600; white-space:nowrap; }
td .avatar { width:28px; height:28px; border-radius:50%; vertical-align:middle; margin-right:8px; }
.tag-chip { display:inline-block; background:#eef2ff; color:#4338ca; border-radius:10px; padding:1px 8px; font-size:11px; margin:1px 2px; }
.tag-chip button { border:none; background:none; cursor:pointer; color:#4338ca; padding:0 0 0 4px; }
.badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; }
.badge.on { background:#e6f9ee; color:#059646; }
.badge.off { background:#fee2e2; color:var(--danger); }
input, textarea, select { font:inherit; padding:8px 10px; border:1px solid var(--line); border-radius:6px; width:100%; }
textarea { min-height:90px; resize:vertical; }
label { font-size:12px; color:var(--sub); display:block; margin:10px 0 4px; }
.btn { font:inherit; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; background:var(--accent); color:#fff; font-weight:600; }
.btn.secondary { background:#e2e8f0; color:var(--text); }
.btn.danger { background:var(--danger); }
.btn.small { padding:4px 10px; font-size:12px; }
.row { display:flex; gap:10px; align-items:end; flex-wrap:wrap; }
.row > div { flex:1; min-width:160px; }
#login { max-width:380px; margin:80px auto; }
.muted { color:var(--sub); font-size:12px; }
.msg-in { color:#0369a1; }
.msg-out { color:#059646; }
#toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1a202c; color:#fff; padding:10px 20px; border-radius:8px; font-size:13px; display:none; }
.hidden { display:none !important; }
</style>
</head>
<body>
<div id="login" class="card">
  <h1 style="margin-bottom:12px">LINE Harness 管理画面</h1>
  <label>管理APIキー（ADMIN_API_KEY）</label>
  <input id="apikey" type="password" autocomplete="current-password" placeholder="キーを入力">
  <div style="margin-top:14px"><button class="btn" onclick="login()">ログイン</button></div>
  <p id="login-err" class="muted" style="color:var(--danger); margin-top:8px"></p>
</div>

<div id="app" class="hidden">
<header>
  <h1>LINE Harness</h1>
  <nav>
    <button data-tab="friends" class="active" onclick="show('friends')">友だち</button>
    <button data-tab="messages" onclick="show('messages')">メッセージ</button>
    <button data-tab="autoreplies" onclick="show('autoreplies')">自動応答</button>
    <button data-tab="broadcast" onclick="show('broadcast')">一斉配信</button>
  </nav>
  <div class="spacer"></div>
  <button class="btn secondary small" onclick="logout()">ログアウト</button>
</header>
<main>
  <section id="tab-friends" class="card">
    <h2 style="font-size:15px; margin-bottom:12px">友だち一覧 <span id="friends-count" class="muted"></span></h2>
    <div class="row" style="margin-bottom:12px">
      <div><input id="new-tag-name" placeholder="新しいタグ名"></div>
      <div style="flex:0"><button class="btn small" onclick="createTag()">タグ作成</button></div>
    </div>
    <div id="tags-list" style="margin-bottom:12px"></div>
    <div style="overflow-x:auto"><table id="friends-table"></table></div>
  </section>

  <section id="tab-messages" class="card hidden">
    <h2 style="font-size:15px; margin-bottom:12px">メッセージログ</h2>
    <div style="overflow-x:auto"><table id="messages-table"></table></div>
  </section>

  <section id="tab-autoreplies" class="card hidden">
    <h2 style="font-size:15px; margin-bottom:12px">自動応答</h2>
    <div class="row">
      <div><label>キーワード</label><input id="ar-keyword"></div>
      <div><label>一致方法</label><select id="ar-match"><option value="contains">含む</option><option value="exact">完全一致</option></select></div>
      <div style="flex:0"><button class="btn" onclick="createAutoReply()">追加</button></div>
    </div>
    <label>返信文</label><textarea id="ar-reply"></textarea>
    <div style="overflow-x:auto; margin-top:16px"><table id="ar-table"></table></div>
  </section>

  <section id="tab-broadcast" class="card hidden">
    <h2 style="font-size:15px; margin-bottom:12px">一斉配信</h2>
    <label>タイトル（管理用メモ）</label><input id="bc-title">
    <label>配信対象</label><select id="bc-tag"><option value="">全フォロワー</option></select>
    <label>本文</label><textarea id="bc-text"></textarea>
    <div style="margin-top:14px"><button class="btn" onclick="prepareBroadcast()">対象人数を確認</button></div>
    <div id="bc-confirm" class="hidden" style="margin-top:14px; padding:14px; background:#fef9c3; border-radius:8px">
      <p id="bc-confirm-text" style="font-size:14px; margin-bottom:10px"></p>
      <button class="btn danger" onclick="sendBroadcast()">送信する</button>
      <button class="btn secondary" onclick="hide('bc-confirm')">キャンセル</button>
    </div>
    <h3 style="font-size:14px; margin:20px 0 8px">配信履歴</h3>
    <div style="overflow-x:auto"><table id="bc-table"></table></div>
  </section>
</main>
</div>
<div id="toast"></div>

<script>
let KEY = sessionStorage.getItem('admin_key') || '';
let TAGS = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (s) => s ? String(s).replace('T',' ').slice(0,16) : '';
function toast(m) { const t=$('toast'); t.textContent=m; t.style.display='block'; setTimeout(()=>t.style.display='none',2500); }
function hide(id) { $(id).classList.add('hidden'); }

async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', ...(opts.headers||{}) },
  });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || res.status); }
  return res.json();
}

async function login() {
  KEY = $('apikey').value.trim();
  try {
    await api('/friends');
    sessionStorage.setItem('admin_key', KEY);
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    loadAll();
  } catch { $('login-err').textContent = 'キーが違います'; }
}
function logout() { sessionStorage.removeItem('admin_key'); location.reload(); }

function show(tab) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['friends','messages','autoreplies','broadcast'].forEach(t => $('tab-'+t).classList.toggle('hidden', t !== tab));
}

async function loadAll() { await loadTags(); loadFriends(); loadMessages(); loadAutoReplies(); loadBroadcasts(); }

async function loadTags() {
  TAGS = await api('/tags');
  $('tags-list').innerHTML = TAGS.length ? 'タグ: ' + TAGS.map(t =>
    '<span class="tag-chip">' + esc(t.name) + '（' + t.friend_count + '）<button onclick="deleteTag(\\'' + t.id + '\\')">×</button></span>'
  ).join('') : '<span class="muted">タグ未作成</span>';
  $('bc-tag').innerHTML = '<option value="">全フォロワー</option>' +
    TAGS.map(t => '<option value="' + t.id + '">' + esc(t.name) + '（' + t.friend_count + '人）</option>').join('');
}

async function createTag() {
  const name = $('new-tag-name').value.trim();
  if (!name) return;
  try { await api('/tags', { method:'POST', body: JSON.stringify({name}) }); $('new-tag-name').value=''; loadTags(); }
  catch (e) { toast('作成失敗: ' + e.message); }
}
async function deleteTag(id) {
  if (!confirm('このタグを削除しますか？（友だちからも外れます）')) return;
  await api('/tags/' + id, { method:'DELETE' }); loadTags(); loadFriends();
}

async function loadFriends() {
  const friends = await api('/friends');
  $('friends-count').textContent = '（' + friends.length + '人）';
  const tagsByFriend = {};
  await Promise.all(friends.map(async f => { tagsByFriend[f.id] = await api('/friends/' + f.id + '/tags'); }));
  $('friends-table').innerHTML =
    '<tr><th>友だち</th><th>状態</th><th>タグ</th><th>登録日</th></tr>' +
    friends.map(f => {
      const chips = (tagsByFriend[f.id]||[]).map(t =>
        '<span class="tag-chip">' + esc(t.name) + '<button onclick="untagFriend(\\'' + f.id + '\\',\\'' + t.id + '\\')">×</button></span>').join('');
      const opts = TAGS.filter(t => !(tagsByFriend[f.id]||[]).some(x => x.id===t.id))
        .map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
      const sel = TAGS.length ? '<select style="width:auto;font-size:11px;padding:2px" onchange="tagFriend(\\'' + f.id + '\\',this.value)"><option value="">+タグ</option>' + opts + '</select>' : '';
      return '<tr><td>' + (f.picture_url ? '<img class="avatar" src="' + esc(f.picture_url) + '">' : '') + esc(f.display_name || '(名前未取得)') +
        '<div class="muted">' + esc(f.line_user_id) + '</div></td>' +
        '<td><span class="badge ' + (f.is_following ? 'on">友だち' : 'off">ブロック中') + '</span></td>' +
        '<td>' + chips + ' ' + sel + '</td><td class="muted">' + fmt(f.followed_at || f.created_at) + '</td></tr>';
    }).join('');
}
async function tagFriend(fid, tid) { if (!tid) return; await api('/friends/' + fid + '/tags', { method:'POST', body: JSON.stringify({tag_id: tid}) }); loadTags(); loadFriends(); }
async function untagFriend(fid, tid) { await api('/friends/' + fid + '/tags/' + tid, { method:'DELETE' }); loadTags(); loadFriends(); }

async function loadMessages() {
  const msgs = await api('/messages');
  const friends = await api('/friends');
  const nameById = Object.fromEntries(friends.map(f => [f.id, f.display_name || f.line_user_id]));
  $('messages-table').innerHTML =
    '<tr><th>日時</th><th>友だち</th><th>方向</th><th>内容</th></tr>' +
    msgs.map(m => '<tr><td class="muted">' + fmt(m.created_at) + '</td><td>' + esc(nameById[m.friend_id] || '-') + '</td>' +
      '<td class="' + (m.direction==='in'?'msg-in">受信':'msg-out">送信') + '</td><td>' + esc(m.content) + '</td></tr>').join('');
}

async function loadAutoReplies() {
  const rows = await api('/auto-replies');
  $('ar-table').innerHTML =
    '<tr><th>キーワード</th><th>一致</th><th>返信文</th><th></th></tr>' +
    rows.map(r => '<tr><td>' + esc(r.keyword) + '</td><td class="muted">' + (r.match_type==='exact'?'完全一致':'含む') + '</td>' +
      '<td>' + esc(r.reply_text) + '</td>' +
      '<td><button class="btn danger small" onclick="deleteAutoReply(\\'' + r.id + '\\')">削除</button></td></tr>').join('');
}
async function createAutoReply() {
  const keyword = $('ar-keyword').value.trim(), reply_text = $('ar-reply').value.trim();
  if (!keyword || !reply_text) { toast('キーワードと返信文を入力してください'); return; }
  await api('/auto-replies', { method:'POST', body: JSON.stringify({keyword, reply_text, match_type: $('ar-match').value}) });
  $('ar-keyword').value=''; $('ar-reply').value=''; loadAutoReplies(); toast('追加しました');
}
async function deleteAutoReply(id) { await api('/auto-replies/' + id, { method:'DELETE' }); loadAutoReplies(); }

async function prepareBroadcast() {
  const text = $('bc-text').value.trim();
  if (!text) { toast('本文を入力してください'); return; }
  const tagId = $('bc-tag').value;
  const { count } = await api('/broadcasts/targets' + (tagId ? '?tag_id=' + tagId : ''));
  const target = tagId ? 'タグ「' + $('bc-tag').selectedOptions[0].text + '」' : '全フォロワー';
  $('bc-confirm-text').textContent = target + ' ' + count + '人に送信します。よろしいですか？';
  $('bc-confirm').classList.remove('hidden');
}
async function sendBroadcast() {
  hide('bc-confirm');
  const body = { title: $('bc-title').value.trim() || null, message_text: $('bc-text').value.trim(), tag_id: $('bc-tag').value || undefined };
  try {
    const r = await api('/broadcasts', { method:'POST', body: JSON.stringify(body) });
    toast(r.sent + '/' + r.targets + '人に送信しました');
    $('bc-title').value=''; $('bc-text').value='';
    loadBroadcasts();
  } catch (e) { toast('送信失敗: ' + e.message); }
}
async function loadBroadcasts() {
  const rows = await api('/broadcasts');
  $('bc-table').innerHTML =
    '<tr><th>日時</th><th>タイトル</th><th>本文</th><th>結果</th></tr>' +
    (rows.length ? rows.map(b => '<tr><td class="muted">' + fmt(b.sent_at || b.created_at) + '</td><td>' + esc(b.title || '-') + '</td>' +
      '<td>' + esc(b.message_text).slice(0,60) + '</td><td>' + (b.status==='sent' ? b.sent_count + '人に送信' : esc(b.status)) + '</td></tr>').join('')
      : '<tr><td colspan="4" class="muted">履歴なし</td></tr>');
}

if (KEY) {
  api('/friends').then(() => { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); loadAll(); })
    .catch(() => {});
}
</script>
</body>
</html>`;
