import { Hono } from 'hono'
import { multicastMessage } from '../line/client'
import { newId, type Bindings } from '../types'

const admin = new Hono<{ Bindings: Bindings }>()

// Bearer認証（ADMIN_API_KEY）
admin.use('*', async (c, next) => {
  const auth = c.req.header('authorization') ?? ''
  if (!c.env.ADMIN_API_KEY || auth !== `Bearer ${c.env.ADMIN_API_KEY}`) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

// 友だち一覧
admin.get('/friends', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM friends ORDER BY created_at DESC LIMIT 200'
  ).all()
  return c.json(results)
})

// メッセージログ
admin.get('/messages', async (c) => {
  const friendId = c.req.query('friend_id')
  const stmt = friendId
    ? c.env.DB.prepare(
        'SELECT * FROM messages_log WHERE friend_id = ? ORDER BY created_at DESC LIMIT 200'
      ).bind(friendId)
    : c.env.DB.prepare('SELECT * FROM messages_log ORDER BY created_at DESC LIMIT 200')
  const { results } = await stmt.all()
  return c.json(results)
})

// 自動応答 CRUD（最小限）
admin.get('/auto-replies', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM auto_replies ORDER BY priority DESC').all()
  return c.json(results)
})

admin.post('/auto-replies', async (c) => {
  const b = await c.req.json<{ keyword: string; reply_text: string; match_type?: string; priority?: number }>()
  if (!b.keyword || !b.reply_text) return c.json({ error: 'keyword and reply_text required' }, 400)
  const id = newId()
  await c.env.DB.prepare(
    `INSERT INTO auto_replies (id, keyword, match_type, reply_text, priority) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, b.keyword, b.match_type ?? 'contains', b.reply_text, b.priority ?? 0)
    .run()
  return c.json({ id }, 201)
})

admin.delete('/auto-replies/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM auto_replies WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ status: 'deleted' })
})

// タグ管理
admin.get('/tags', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, COUNT(ft.friend_id) AS friend_count
     FROM tags t LEFT JOIN friend_tags ft ON t.id = ft.tag_id
     GROUP BY t.id ORDER BY t.created_at`
  ).all()
  return c.json(results)
})

admin.post('/tags', async (c) => {
  const b = await c.req.json<{ name: string }>()
  if (!b.name) return c.json({ error: 'name required' }, 400)
  const id = newId()
  try {
    await c.env.DB.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').bind(id, b.name).run()
  } catch {
    return c.json({ error: 'duplicate name' }, 409)
  }
  return c.json({ id }, 201)
})

admin.delete('/tags/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ status: 'deleted' })
})

admin.post('/friends/:friendId/tags', async (c) => {
  const b = await c.req.json<{ tag_id: string }>()
  if (!b.tag_id) return c.json({ error: 'tag_id required' }, 400)
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO friend_tags (friend_id, tag_id) VALUES (?, ?)'
  ).bind(c.req.param('friendId'), b.tag_id).run()
  return c.json({ status: 'ok' })
})

admin.delete('/friends/:friendId/tags/:tagId', async (c) => {
  await c.env.DB.prepare('DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
    .bind(c.req.param('friendId'), c.req.param('tagId')).run()
  return c.json({ status: 'deleted' })
})

// 友だちごとのタグ
admin.get('/friends/:friendId/tags', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name FROM tags t JOIN friend_tags ft ON t.id = ft.tag_id WHERE ft.friend_id = ?`
  ).bind(c.req.param('friendId')).all()
  return c.json(results)
})

// 配信履歴
admin.get('/broadcasts', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 100'
  ).all()
  return c.json(results)
})

// 配信対象人数プレビュー（送信前確認用）
admin.get('/broadcasts/targets', async (c) => {
  const tagId = c.req.query('tag_id')
  const stmt = tagId
    ? c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM friends f
         JOIN friend_tags ft ON f.id = ft.friend_id
         WHERE ft.tag_id = ? AND f.is_following = 1`
      ).bind(tagId)
    : c.env.DB.prepare('SELECT COUNT(*) AS count FROM friends WHERE is_following = 1')
  const row = await stmt.first<{ count: number }>()
  return c.json({ count: row?.count ?? 0 })
})

// 一斉配信（tag_id指定でタグ絞り込み、省略で全フォロワー）
admin.post('/broadcasts', async (c) => {
  const b = await c.req.json<{ title?: string; message_text: string; tag_id?: string }>()
  if (!b.message_text) return c.json({ error: 'message_text required' }, 400)

  const stmt = b.tag_id
    ? c.env.DB.prepare(
        `SELECT f.line_user_id FROM friends f
         JOIN friend_tags ft ON f.id = ft.friend_id
         WHERE ft.tag_id = ? AND f.is_following = 1`
      ).bind(b.tag_id)
    : c.env.DB.prepare('SELECT line_user_id FROM friends WHERE is_following = 1')
  const { results } = await stmt.all<{ line_user_id: string }>()

  const broadcastId = newId()
  await c.env.DB.prepare(
    `INSERT INTO broadcasts (id, title, message_text, tag_id, status) VALUES (?, ?, ?, ?, 'draft')`
  )
    .bind(broadcastId, b.title ?? null, b.message_text, b.tag_id ?? null)
    .run()

  // multicastは最大500人/回
  let sent = 0
  const messages = [{ type: 'text', text: b.message_text }]
  for (let i = 0; i < results.length; i += 500) {
    const chunk = results.slice(i, i + 500).map((r) => r.line_user_id)
    const res = await multicastMessage(c.env.LINE_CHANNEL_ACCESS_TOKEN, chunk, messages)
    if (res.ok) sent += chunk.length
  }

  await c.env.DB.prepare(
    `UPDATE broadcasts SET status = ?, sent_count = ?, sent_at = ? WHERE id = ?`
  )
    .bind(sent > 0 || results.length === 0 ? 'sent' : 'failed', sent, new Date().toISOString(), broadcastId)
    .run()

  return c.json({ id: broadcastId, targets: results.length, sent })
})

export default admin
