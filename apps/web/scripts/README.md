# Safari-compatible admin deployment

The admin must send authenticated requests to its own origin. Safari can block
session cookies if the browser calls a separate `workers.dev` site directly.

Build with both variables set:

- `NEXT_PUBLIC_API_URL`: the production admin HTTPS origin (Pages or custom domain).
- `ADMIN_API_UPSTREAM`: the existing Worker API HTTPS origin.

Run `pnpm --filter web build`. The build writes `out/_worker.js` and `out/_routes.json`
alongside the static export. Deploy the entire `out` directory with Wrangler Pages.
Do not publish only static files or omit the build step that generates the proxy.

The proxy forwards `/api/*` and `/admin/*` to the fixed upstream, preserving
HttpOnly session cookies and the API's authentication/CSRF checks. Responses are
not cached. `/auth/*` redirects to the original API so LINE OAuth retains its
registered callback origin. No API credentials are embedded in the proxy.

The existing Worker's `ADMIN_ORIGIN` must allow the admin origin. Existing SDK/MCP
clients continue to use the Worker URL directly. Without `ADMIN_API_UPSTREAM`, the
build remains a static export for deployments already on a compatible same-site
API domain. API keys must not be placed in public build variables.
