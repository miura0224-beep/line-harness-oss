/**
 * お客様に渡すURL（/r/ リファラル、/pool/、/o?liffId= など）の組み立て先。
 *
 * 管理画面の API 呼び出しは同一ドメインの中継（pages.dev/api/*）を通るため
 * NEXT_PUBLIC_API_URL は管理画面のドメインになる。公開URLにそれを使うと
 * pages.dev/r/xxx のような「中継対象外＝404」のリンクが生成されてしまうので、
 * 公開URLは必ず Worker のドメイン（NEXT_PUBLIC_WORKER_URL）から組み立てる。
 */
export function workerBase(): string {
  const url = process.env.NEXT_PUBLIC_WORKER_URL || process.env.NEXT_PUBLIC_API_URL || ''
  return url.replace(/\/$/, '')
}
