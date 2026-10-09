import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminProxy } from './admin-proxy.mjs'

const proxy = createAdminProxy('https://api.example.com')
const assets = { ASSETS: { fetch: vi.fn(async () => new Response('static')) } }
afterEach(() => vi.unstubAllGlobals())

describe('same-origin admin authentication proxy', () => {
  it('preserves login body and both cookies, and never caches authentication', async () => {
    const upstream = vi.fn(async (request: Request, options: RequestInit) => {
      expect(request.url).toBe('https://api.example.com/api/auth/login')
      expect(request.method).toBe('POST')
      expect(request.headers.get('Origin')).toBe('https://admin.example.com')
      expect(await request.json()).toEqual({ apiKey: 'test-key' })
      expect(options.redirect).toBe('manual')
      const headers = new Headers()
      headers.append('Set-Cookie', 'lh_admin_session=test; Path=/; Secure; HttpOnly; SameSite=None')
      headers.append('Set-Cookie', 'lh_csrf=csrf; Path=/; Secure; SameSite=None')
      return new Response('{"success":true}', { headers })
    })
    vi.stubGlobal('fetch', upstream)
    const result = await proxy.fetch(new Request('https://admin.example.com/api/auth/login', {
      method: 'POST', headers: { Origin: 'https://admin.example.com' }, body: JSON.stringify({ apiKey: 'test-key' }),
    }), assets)
    expect(result.headers.getSetCookie()).toHaveLength(2)
    expect(result.headers.getSetCookie()[0]).toContain('HttpOnly')
    expect(result.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it('preserves cookies and CSRF for API authorization, and propagates rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      expect(request.headers.get('Cookie')).toBe('lh_admin_session=session; lh_csrf=csrf')
      expect(request.headers.get('X-CSRF-Token')).toBe('wrong-csrf')
      return new Response('CSRF token mismatch', { status: 403 })
    }))
    const result = await proxy.fetch(new Request('https://admin.example.com/api/chats/f1', {
      method: 'PUT', headers: { Cookie: 'lh_admin_session=session; lh_csrf=csrf', 'X-CSRF-Token': 'wrong-csrf' }, body: '{}',
    }), assets)
    expect(result.status).toBe(403)
  })
  it('rejects foreign-origin mutations before reaching the API', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const result = await proxy.fetch(new Request('https://admin.example.com/api/auth/login', {
      method: 'POST', headers: { Origin: 'https://attacker.example' }, body: '{}',
    }), assets)
    expect(result.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses only its configured upstream even when a query contains another URL', async () => {
    const fetch = vi.fn(async () => new Response('ok')); vi.stubGlobal('fetch', fetch)
    await proxy.fetch(new Request('https://admin.example.com/api/chats?url=https://attacker.example'), assets)
    expect(new URL(fetch.mock.calls[0][0].url).origin).toBe('https://api.example.com')
  })
  it('serves static files and starts LINE OAuth on the registered API origin', async () => {
    expect(await (await proxy.fetch(new Request('https://admin.example.com/login'), assets)).text()).toBe('static')
    const response = await proxy.fetch(new Request('https://admin.example.com/auth/line?account=one'), assets)
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://api.example.com/auth/line?account=one')
  })
  it('returns a non-cacheable gateway error without disclosing upstream failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('internal details')))
    const response = await proxy.fetch(new Request('https://admin.example.com/api/auth/session'), assets)
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).not.toContain('internal details')
  })
})
