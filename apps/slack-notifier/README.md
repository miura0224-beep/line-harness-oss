# ブリッジスター塾生LINEのGoogleチャット通知

2026-11-17、通知先をSlackからGoogleチャットへ移した。フォルダ名・Worker名・台帳テーブル名に
`slack` が残っているのは、送信済みの記録（重複防止）と既存の送信Webhookを引き継ぐためで、
Slackへは送らない。

本番 Worker: `line-harness-bridge-slack`
対象アカウント: `57f74bd1-8b1b-48d9-bb5f-7bccb78d5a0c`
通知先: Googleチャットのスペース「ブリッジスター塾生ライン通知」
（https://chat.google.com/app/chat/AAQAKuFl4hQ 。着信Webhook名「塾生LINE通知」。
スペースの「アプリと統合」→「Webhook」で確認・再発行できる）
旧通知先（停止）: Slack `C0B0WQW64EQ`（#05-塾生line / bridge★）

## 通知経路

毎分のcronで `messages_log` の受信記録と `bridge_slack_deliveries` を照合する。
未登録のメッセージを永続キューに追加し、Googleチャットへ送る。テキスト・画像・ファイル・
スタンプ等すべての受信形式を対象にする。送信者名、日本時間の受信日時、本文または
添付種別・ファイル名、「個別チャットで返信する」リンクを表示する。
送信者名と本文の `<` `>` は全角に置き換える（お客様の入力が全員宛てメンションやリンクにならない）。
添付の内容は個別チャットから確認する。保存済み記録にファイル本体がない場合、
この通知処理では本体を復元しない。

署名付き `POST /notify` も受け付けるが、これはDB照合を促すだけであり、
リクエスト本文をそのままGoogleチャットへ転送しない。Webhookが届かなくてもcronで回収する。
友だちの所属に加え、受信ログ自身に所属がある場合はそちらも照合する。

Secrets（値をコミットしない）:
- `GOOGLE_CHAT_WEBHOOK_URL`（上記スペースの着信Webhook。`chat.googleapis.com/v1/spaces/…/messages` 以外は送信しない）
- `HARNESS_WEBHOOK_SECRET`（Harness送信Webhookと一致）

既存送信Webhook ID: `8a078a03-8051-4ad4-adf2-1ed5a3436ecb`
停止済み旧簡易ルール: `a1bda7b1-3c8b-4915-9d35-a48afda6681b`
旧簡易ルールを有効化すると重複投稿になるため、有効化しない。

## 重複防止・再試行

送信済みキーは `message:<messages_log.id>`。送信成功後はカード本文を削除し、
キーだけを期限なしで保持する。**送信済みキーを削除すると過去分を再投稿する。**
受信日時や本文の一致ではなく、保存済みメッセージIDで識別するため、同じ文面の
別メッセージも取りこぼさない。送信の排他取得と2分のleaseで多重実行を抑止する。
1回に最大30件、間隔1.1秒。失敗時は指数バックオフ（最大1時間）で再試行する。
Googleチャット側で受信した直後に通信が切れた場合、着信Webhookに冪等性保証がないため、
まれな重複は完全には排除できない。

cronログ `bridge_chat_reconciliation` の `queued` / `sent` / `failed` と
台帳の `pending` / `sending` 件数を確認する。失敗時は `chat_delivery_failed` が残る。
移行前にSlack形式で積まれた未送信分が残っていた場合も、同じ内容を文章に直して送る。

## 2026-09-21の復旧

調査時点の受信は35件、既存配信台帳はテスト投稿1件のみ。Slack画面でも同じ状況を確認。
`19f3ea1b-ff75-4a2c-8ee3-7c6ce95d38a6`（テスト3）は既送信として新キーへ引き継いだ。
残る34件（テキスト28・画像2・ファイル4）を回収対象にした。
`BACKFILL_BEFORE` より前の受信は「通知復旧に伴う過去の未通知分」と明記する。

旧経路の問題:
- 本番の転送元は同一ゾーン内Workerへの通常fetchで、service bindingも
  `global_fetch_strictly_public` もなかった。CloudflareがサポートするWorker間呼び出しの
  条件を満たしていない（当時の個別リクエストの応答コードは保存されていない）。
- 転送元はHTTPの成功・失敗を検査せず、永続的な再送記録も持っていなかった。
- 受信処理は画像・ファイル等で `message_received` を発火しなかった。
- 旧cronは中継に到着済みのキューだけを再送しており、到着しなかった通知を発見できなかった。

今回、受信DBを直接照合する経路を本番化し、これらの転送条件への依存をなくした。
LINEの自動返信や他アカウントの通知経路は今回の変更対象にしていない。

## 検証・デプロイ

```sh
node --test apps/slack-notifier/worker.test.mjs
WRANGLER_LOG_PATH=/tmp/bridge-slack-build.log node_modules/.bin/wrangler deploy --config apps/slack-notifier/wrangler.jsonc --dry-run
node_modules/.bin/wrangler deploy --config apps/slack-notifier/wrangler.jsonc
```

初回のみ `schema.sql` を適用する。既存DBのテーブル再構築は不要。

復旧完了結果: 2026-09-21 15時台、cronで30件＋4件を送信、失敗0。
台帳は既送信テストを含む35件すべてsent、全受信との照合で未通知0件、各1回の送信。
Slack Webの指定チャンネルで送信者・受信日時・復旧注記・返信ボタンの表示を確認した。
確認投稿例: https://bridge-r9g7347.slack.com/archives/C0B0WQW64EQ/p1789971699720529
本番バージョン: `b6b94ebc-bc6a-49e2-9546-c2289c9e976c`
LINE APIでもWebhookは `https://line-harness.miura0224.workers.dev/webhook`、active=trueを確認。
その次のcron実行も queued=0 / sent=0 / failed=0 で成功し、過去分の重複送信なしを確認。

## bridge★ 公式LINE（文章以外の受信）

2026-11-17 追加。同じ `worker.mjs` を別名 `line-harness-bridge-official-notify`（設定は
`wrangler.official.jsonc`）でも動かし、bridge★ 公式LINE（`8c6b6352-d0ea-4cb4-ae60-b1a5a27bb1b2`）の
画像・ファイル・スタンプなど文章以外の受信を、Googleチャット「ブリッジスター公式LINE通知」
（https://chat.google.com/app/chat/AAQAUxGgqWw 、着信Webhook名「公式LINE通知」）へ送る。

- 文章の受信は `threestars-cs` が同じスペースへ送っている（キーワード自動返信の有無つき）。
  二重にならないよう、こちらは `ONLY_NON_TEXT=1` で文章を扱わない。
- 台帳は `bridge_official_deliveries`（`OUTBOX_TABLE`）。塾生LINEの台帳とは別。初回実行時に自動で作る。
- `START_AFTER` より前の受信は通知しない（導入前の履歴を流さないため）。
- 送信Webhookは使わず、毎分のcronだけで拾う（通知は最大1分ほど遅れる）。
- Secret: `GOOGLE_CHAT_WEBHOOK_URL`

```sh
node_modules/.bin/wrangler deploy --config apps/slack-notifier/wrangler.official.jsonc
```
