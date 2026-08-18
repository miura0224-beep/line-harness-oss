import { Hono } from 'hono'
import webhook from './routes/webhook'
import admin from './routes/admin'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.json({ name: 'line-harness', status: 'ok' }))
app.route('/webhook', webhook)
app.route('/api/admin', admin)

export default app
