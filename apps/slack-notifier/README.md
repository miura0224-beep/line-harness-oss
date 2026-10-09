# ブリッジスター塾生LINEのSlack通知

本番 Worker: `line-harness-bridge-slack`
対象アカウント: `57f74bd1-8b1b-48d9-bb5f-7bccb78d5a0c`
Slack: `C0B0WQW64EQ`（#05-塾生line / bridge★）

## 通知経路

毎分のcronで `messages_log` の受信記録と `bridge_slack_deliveries` を照合する。
未登録のメッセージを永続キューに追加し、Slackへ送る。テキスト・画像・ファイル・
スタンプ等すべての受信形式を対象にする。送信者名、日本時間の受信日時、本文または
添付種別・ファイル名、「個別チャットで返信する」ボタンを表示する。
添付の内容は個別チャットから確認する。保存済み記録にファイル本体がない場合、
この通知処理では本体を復元しない。

署名付き `POST /notify` も受け付けるが、これはDB照合を促すだけであり、
リクエスト本文をそのままSlackへ転送しない。Webhookが届かなくてもcronで回収する。
友だちの所属に加え、受信ログ自身に所属がある場合はそちらも照合する。

Secrets（値をコミットしない）:
- `SLACK_WEBHOOK_URL`
- `HARNESS_WEBHOOK_SECRET`（Harness送信Webhookと一致）

既存送信Webhook ID: `8a078a03-8051-4ad4-adf2-1ed5a3436ecb`
停止済み旧簡易ルール: `a1bda7b1-3c8b-4915-9d35-a48afda6681b`
旧簡易ルールを有効化すると重複投稿になるため、有効化しない。

## 重複防止・再試行

送信済みキーは `message:<messages_log.id>`。Slack成功後はカード本文を削除し、
キーだけを期限なしで保持する。**送信済みキーを削除すると過去分を再投稿する。**
受信日時や本文の一致ではなく、保存済みメッセージIDで識別するため、同じ文面の
別メッセージも取りこぼさない。送信の排他取得と2分のleaseで多重実行を抑止する。
1回に最大30件、間隔1.1秒。失敗時は指数バックオフ（最大1時間）で再試行する。
Slack側で受信した直後に通信が切れた場合、Incoming Webhookに冪等性保証がないため、
まれな重複は完全には排除できない。

cronログ `bridge_slack_reconciliation` の `queued` / `sent` / `failed` と
台帳の `pending` / `sending` 件数を確認する。失敗時は `slack_delivery_failed` が残る。

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
