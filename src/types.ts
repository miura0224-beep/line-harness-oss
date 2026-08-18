export type Bindings = {
  DB: D1Database
  LINE_CHANNEL_SECRET: string
  LINE_CHANNEL_ACCESS_TOKEN: string
  ADMIN_API_KEY: string
}

export const newId = () => crypto.randomUUID()
