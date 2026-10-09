import { readFile, writeFile } from 'node:fs/promises'
import { createAdminProxy } from '../src/server/admin-proxy.mjs'

const upstream = process.env.ADMIN_API_UPSTREAM
if (upstream) {
  createAdminProxy(upstream) // Validate before producing a deployable artifact.
  const publicUrl = new URL(process.env.NEXT_PUBLIC_API_URL)
  if (publicUrl.origin === new URL(upstream).origin || publicUrl.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_API_URL must be the HTTPS admin origin, distinct from ADMIN_API_UPSTREAM')
  }
  const source = await readFile(new URL('../src/server/admin-proxy.mjs', import.meta.url), 'utf8')
  await writeFile(new URL('../out/_worker.js', import.meta.url), source + `\nexport default createAdminProxy(${JSON.stringify(upstream)});\n`)
  await writeFile(new URL('../out/_routes.json', import.meta.url), JSON.stringify({
    version: 1, include: ['/api/*', '/admin/*', '/auth/*'], exclude: [],
  }))
  console.log('Built same-origin admin API proxy')
}
