/**
 * Keep browser authentication on the Pages origin. Safari blocks cookies when
 * the browser calls a separate workers.dev site directly. The API remains the
 * authority for session validation, roles and CSRF; this proxy grants no access.
 * @param {string} apiOrigin Build-time trusted upstream, never supplied by a request.
 */
export function createAdminProxy(apiOrigin) {
  const upstream = new URL(apiOrigin)
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('ADMIN_API_UPSTREAM must be an HTTPS origin')
  }
  return {
    /** @param {Request} request @param {{ ASSETS: { fetch(request: Request): Promise<Response> } }} env */
    async fetch(request, env) {
      const url = new URL(request.url)
      const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')
      // LINE OAuth must run on its registered callback origin, with its own cookies.
      if (url.pathname.startsWith('/auth/')) {
        const target = new URL(upstream)
        target.pathname = url.pathname
        target.search = url.search
        return Response.redirect(target.href, 302)
      }
      if (!isApi) return env.ASSETS.fetch(request)
      if (url.origin === upstream.origin) return new Response('Invalid API proxy configuration', { status: 503 })

      // Do not allow a different site to drive cookie-authenticated mutations,
      // including login. Keep the API's existing CSRF validation in addition.
      const origin = request.headers.get('Origin')
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) {
        return Response.json({ success: false, error: 'Origin not allowed' }, { status: 403 })
      }
      const target = new URL(upstream)
      target.pathname = url.pathname
      target.search = url.search
      try {
        const forwarded = new Request(target.href, request)
        forwarded.headers.delete('Host')
        // Avoid forwarding credentials to a redirect destination.
        const result = await fetch(forwarded, { redirect: 'manual' })
        const response = new Response(result.body, result)
        // Session and personalized data must never enter an intermediary cache.
        response.headers.set('Cache-Control', 'private, no-store')
        return response
      } catch {
        return Response.json({ success: false, error: 'サーバーに接続できません。時間をおいて再度お試しください。' }, {
          status: 502, headers: { 'Cache-Control': 'no-store' },
        })
      }
    },
  }
}
