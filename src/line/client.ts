// LINE Messaging API クライアント（最小限）
const BASE = 'https://api.line.me/v2/bot'

async function call(token: string, path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`LINE API ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res
}

export const replyMessage = (token: string, replyToken: string, messages: unknown[]) =>
  call(token, '/message/reply', { replyToken, messages })

export const pushMessage = (token: string, to: string, messages: unknown[]) =>
  call(token, '/message/push', { to, messages })

export const multicastMessage = (token: string, to: string[], messages: unknown[]) =>
  call(token, '/message/multicast', { to, messages })

export async function getProfile(token: string, userId: string) {
  const res = await fetch(`${BASE}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.json<{ displayName: string; pictureUrl?: string; statusMessage?: string }>()
}
