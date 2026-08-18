# line-harness-oss

LINE Messaging API のハーネス（Cloudflare Workers + Hono + D1）。
Webhook受信・友だち管理・メッセージログ・キーワード自動応答・タグ別一斉配信を最小構成で提供します。

## 構成

```
LINE Platform ──Webhook──> Cloudflare Worker (Hono)
                              ├── 署名検証 (X-Line-Signature / HMAC-SHA256)
                              ├── D1: friends / tags / messages_log / auto_replies / broadcasts
                              └── /api/admin/* (Bearer認証の管理API)
```

## セットアップ

### 1. 依存関係

```bash
npm install
```

### 2. LINE Developers でチャネル作成

1. https://developers.line.biz/ で Messaging API チャネルを作成
2. チャネルシークレットとチャネルアクセストークン（長期）を控える
3. 「Webhookの利用」をON、「応答メッセージ」をOFF

### 3. D1 データベース作成

```bash
npx wrangler d1 create line-harness
```

出力された `database_id` を `wrangler.jsonc` の `REPLACE_WITH_D1_ID` に設定し、マイグレーションを適用:

```bash
npm run db:migrate:prod
```

### 4. シークレット設定

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ADMIN_API_KEY   # 管理API用の任意の強いランダム文字列
```

### 5. デプロイ & Webhook URL 設定

```bash
npm run deploy
```

デプロイ後のURL `https://line-harness.<subdomain>.workers.dev/webhook` を
LINE Developers の Webhook URL に設定し、「検証」ボタンで疎通確認。

## ローカル開発

```bash
cp .dev.vars.example .dev.vars   # 値を記入
npm run db:migrate:local
npm run dev
```

## 管理API

すべて `Authorization: Bearer $ADMIN_API_KEY` が必要。

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/admin/friends` | 友だち一覧 |
| GET | `/api/admin/messages?friend_id=` | メッセージログ |
| GET | `/api/admin/auto-replies` | 自動応答一覧 |
| POST | `/api/admin/auto-replies` | 自動応答作成 `{keyword, reply_text, match_type?, priority?}` |
| DELETE | `/api/admin/auto-replies/:id` | 自動応答削除 |
| POST | `/api/admin/broadcasts` | 一斉配信 `{message_text, title?, tag_id?}` |

## セキュリティ / データの注意

- Webhook は署名検証必須。検証失敗は 401。
- `friends` テーブルは個人情報（LINE UID・表示名）を含む。**データやバックアップJSONを絶対にコミットしないこと**（`.gitignore` で `*.data.json` を除外済み）。
- シークレットは Cloudflare Secrets で管理し、コードや設定ファイルに書かない。

## License

MIT
