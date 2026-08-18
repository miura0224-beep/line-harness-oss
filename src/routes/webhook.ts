import { Hono } from 'hono'
import { verifyLineSignature } from '../line/signature'
import { getProfile, replyMessage } from '../line/client'
import { newId, type Bindings } from '../types'

const webhook = new Hono<{ Bindings: Bindings }>()

webhook.post('/', async (c) => {
  const rawBody = await c.req.text()
  const ok = await verifyLineSignature(
    c.env.LINE_CHANNEL_SECRET,
    rawBody,
    c.req.header('x-line-signature')
  )
  if (!ok) return c.json({ error: 'invalid signature' }, 401)

  const body = JSON.parse(rawBody)
  // LINEはWebhookを再送しないため、処理はwaitUntilに逃がして即200を返す
  c.executionCtx.waitUntil(handleEvents(c.env, body.events ?? []))
  return c.json({ status: 'ok' })
})

async function handleEvents(env: Bindings, events: any[]) {
  for (const event of events) {
    try {
      await handleEvent(env, event)
    } catch (e) {
      console.error('event handling error:', e, JSON.stringify(event))
    }
  }
}

async function handleEvent(env: Bindings, event: any) {
  const lineUserId: string | undefined = event.source?.userId
  if (!lineUserId) return

  const friendId = await upsertFriend(env, lineUserId, event.type)

  if (event.type === 'message') {
    await env.DB.prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, line_message_id)
       VALUES (?, ?, 'in', ?, ?, ?)`
    )
      .bind(
        newId(),
        friendId,
        event.message?.type ?? 'unknown',
        event.message?.type === 'text' ? event.message.text : JSON.stringify(event.message),
        event.message?.id ?? null
      )
      .run()

    if (event.message?.type === 'text' && event.replyToken) {
      await tryAutoReply(env, friendId, event.replyToken, event.message.text)
    }
  }
}

async function upsertFriend(env: Bindings, lineUserId: string, eventType: string): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM friends WHERE line_user_id = ?')
    .bind(lineUserId)
    .first<{ id: string }>()

  const now = new Date().toISOString()

  if (eventType === 'unfollow') {
    if (existing) {
      await env.DB.prepare(
        `UPDATE friends SET is_following = 0, unfollowed_at = ?, updated_at = ? WHERE id = ?`
      )
        .bind(now, now, existing.id)
        .run()
      return existing.id
    }
  }

  const profile = env.LINE_CHANNEL_ACCESS_TOKEN
    ? await getProfile(env.LINE_CHANNEL_ACCESS_TOKEN, lineUserId)
    : null

  if (existing) {
    await env.DB.prepare(
      `UPDATE friends SET is_following = 1, display_name = COALESCE(?, display_name),
         picture_url = COALESCE(?, picture_url), status_message = COALESCE(?, status_message),
         updated_at = ? WHERE id = ?`
    )
      .bind(profile?.displayName ?? null, profile?.pictureUrl ?? null, profile?.statusMessage ?? null, now, existing.id)
      .run()
    return existing.id
  }

  const id = newId()
  await env.DB.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, picture_url, status_message, is_following, followed_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  )
    .bind(id, lineUserId, profile?.displayName ?? null, profile?.pictureUrl ?? null, profile?.statusMessage ?? null, now)
    .run()
  return id
}

async function tryAutoReply(env: Bindings, friendId: string, replyToken: string, text: string) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM auto_replies WHERE is_active = 1 ORDER BY priority DESC`
  ).all<any>()

  const match = results.find((r) =>
    r.match_type === 'exact' ? r.keyword === text : text.includes(r.keyword)
  )
  if (!match) return

  if (env.LINE_CHANNEL_ACCESS_TOKEN) {
    await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, [
      { type: 'text', text: match.reply_text },
    ])
  }
  await env.DB.prepare(
    `INSERT INTO messages_log (id, friend_id, direction, message_type, content)
     VALUES (?, ?, 'out', 'text', ?)`
  )
    .bind(newId(), friendId, match.reply_text)
    .run()
}

export default webhook
