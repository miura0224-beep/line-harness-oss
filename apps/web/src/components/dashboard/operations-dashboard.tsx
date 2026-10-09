'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, fetchApi, type ApiBroadcast } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'

interface RecentChat {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  lastMessageAt: string | null
  lastMessageContent: string | null
  lastMessageDirection: string | null
  lastMessageType: string | null
  status: string
}
interface Summary { unread: number; inProgress: number; resolved: number }
type Result<T> = { success: boolean; data: T }
const labels: Record<string, string> = { unread: '未読', in_progress: '対応中', resolved: '解決済' }

function time(value: string | null) {
  if (!value) return '日時未設定'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '日時未設定' : date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function preview(type: string | null, content: string | null) {
  if (type === 'text') return content || '本文なし'
  return ({ image: '画像メッセージ', video: '動画メッセージ', sticker: 'スタンプ', flex: 'カードメッセージ', audio: '音声メッセージ' } as Record<string, string>)[type || ''] || 'メッセージを開く'
}

export default function OperationsDashboard() {
  const { selectedAccount, selectedAccountId, loading: accountLoading } = useAccount()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [chats, setChats] = useState<RecentChat[] | null>(null)
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[] | null>(null)
  const [unanswered, setUnanswered] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [updated, setUpdated] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (accountLoading) return
    let cancelled = false
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      setLoading(true)
      const account = selectedAccountId || undefined
      const results = await Promise.allSettled([
        fetchApi<Result<Summary>>('/api/chats/summary' + (account ? `?lineAccountId=${encodeURIComponent(account)}` : '')),
        fetchApi<Result<RecentChat[]>>('/api/chats?' + new URLSearchParams({ limit: '6', ...(account ? { lineAccountId: account } : {}) })),
        api.broadcasts.list({ accountId: account }),
        api.inbox.unanswered.list({ account, pageSize: 1 }),
      ])
      if (cancelled) return
      const failures: string[] = []
      const [s, c, b, u] = results
      if (s.status === 'fulfilled' && s.value.success) setSummary(s.value.data)
      else { setSummary(null); failures.push('対応件数') }
      if (c.status === 'fulfilled' && c.value.success) setChats(c.value.data)
      else { setChats(null); failures.push('チャット') }
      if (b.status === 'fulfilled' && b.value.success) setBroadcasts(b.value.data)
      else { setBroadcasts(null); failures.push('配信') }
      if (u.status === 'fulfilled' && u.value.success) setUnanswered(u.value.data.total)
      else { setUnanswered(null); failures.push('未対応件数') }
      setErrors(failures)
      setUpdated(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }))
      setLoading(false)
      busy = false
    }
    setSummary(null); setChats(null); setBroadcasts(null); setUnanswered(null); setUpdated(null); setErrors([])
    void load()
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void load() }
    const interval = window.setInterval(visibleRefresh, 60000)
    document.addEventListener('visibilitychange', visibleRefresh)
    window.addEventListener(UNANSWERED_REFRESH_EVENT, visibleRefresh)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visibleRefresh)
      window.removeEventListener(UNANSWERED_REFRESH_EVENT, visibleRefresh)
    }
  }, [selectedAccountId, accountLoading, refresh])

  const scheduled = broadcasts?.filter(b => b.status === 'scheduled').sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''))
  const sending = broadcasts?.filter(b => b.status === 'sending')
  const number = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('ja-JP')

  return <div className="space-y-6">
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-semibold tracking-widest text-emerald-700">LINE HARNESS</p><h1 className="mt-1 text-2xl font-bold tracking-tight">運用ダッシュボード</h1><p className="mt-1 truncate text-sm text-gray-500">{selectedAccount?.displayName || selectedAccount?.name || 'すべてのアカウント'}</p></div>
      <button disabled={loading} onClick={() => setRefresh(v => v + 1)} className="min-h-11 shrink-0 rounded-full border border-gray-200 bg-white px-4 text-sm font-medium disabled:opacity-50" aria-label="ダッシュボードを更新">{loading ? '更新中' : '↻ 更新'}</button>
    </header>
    {errors.length > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{errors.join('・')}を取得できませんでした。更新ボタンから再試行できます。</div>}
    <section className="overflow-hidden rounded-3xl bg-emerald-950 p-5 text-white sm:p-7">
      <div className="flex items-center justify-between"><p className="text-sm text-emerald-100">担当者の返信を待っています</p><span className="rounded-full bg-white/10 px-3 py-1 text-xs">要確認</span></div>
      <div className="mt-3 flex items-end gap-2"><span className="text-5xl font-semibold tracking-tight">{number(unanswered)}</span><span className="pb-1 text-sm text-emerald-100">件</span></div>
      <p className="mt-3 text-xs leading-relaxed text-emerald-100">AIや自動配信の返信後も、担当者の確認が必要なチャットを含みます。</p>
      <Link href="/chats?unanswered=1" className="mt-5 flex min-h-12 items-center justify-between rounded-xl bg-white px-4 text-sm font-semibold text-emerald-950">未対応のチャットを見る <span aria-hidden="true">→</span></Link>
    </section>
    <section aria-label="対応状況" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { title: '対応済み', value: summary?.resolved, unit: '人', hint: '解決済みにした相手', href: '/chats?status=resolved' },
        { title: '対応中', value: summary?.inProgress, unit: '人', hint: 'やり取りを継続中', href: '/chats?status=in_progress' },
        { title: '予約配信', value: scheduled?.length, unit: '件', hint: '一斉配信の送信予定', href: '/broadcasts' },
        { title: '配信中', value: sending?.length, unit: '件', hint: '一斉配信を送信中', href: '/broadcasts' },
      ].map(card => <Link key={card.title} href={card.href} className="rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-emerald-400"><p className="text-sm font-medium text-gray-600">{card.title}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{number(card.value)}<span className="ml-1 text-xs font-normal text-gray-500">{card.unit}</span></p><p className="mt-2 text-xs text-gray-500">{card.hint}</p></Link>)}
    </section>
    <p className="!mt-2 text-xs text-gray-500">対応済みは、選択中のLINE公式アカウントで「解決済み」に登録された相手の人数です。</p>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between p-4"><h2 className="font-bold">最近の個別チャット</h2><Link className="flex min-h-11 items-center text-sm font-medium text-emerald-700" href="/chats">すべて見る →</Link></div>
        {chats === null ? <p className="px-4 pb-5 text-sm text-gray-500">{loading ? '読み込み中…' : 'チャットを取得できませんでした'}</p> : chats.length === 0 ? <p className="px-4 pb-5 text-sm text-gray-500">まだチャットはありません。</p> : chats.map(chat => <Link href={`/chats?friend=${encodeURIComponent(chat.friendId)}`} key={chat.id} className="flex gap-3 border-t border-gray-100 p-4 hover:bg-emerald-50">
          {chat.friendPictureUrl ? <img src={chat.friendPictureUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 font-semibold text-emerald-700">{(chat.friendName || '?').slice(0, 1)}</span>}
          <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{chat.friendName || '名前未設定'}</p><time className="shrink-0 text-[11px] text-gray-500">{time(chat.lastMessageAt)}</time></div><p className="mt-1 truncate text-sm text-gray-500">{chat.lastMessageDirection === 'outgoing' ? '送信：' : ''}{preview(chat.lastMessageType, chat.lastMessageContent)}</p><span className="mt-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{labels[chat.status] || chat.status}</span></div>
        </Link>)}
      </section>
      <div className="space-y-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-4"><h2 className="font-bold">配信スケジュール</h2><p className="mt-1 text-xs text-gray-500">送信中と、次の予約配信を確認</p>
          {broadcasts === null ? <p className="mt-4 text-sm text-gray-500">{loading ? '読み込み中…' : '配信を取得できませんでした'}</p> : [...(sending || []), ...(scheduled || [])].length === 0 ? <p className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">送信中・予約済みの一斉配信はありません。</p> : [...(sending || []), ...(scheduled || [])].slice(0, 5).map(b => <details key={b.id} className="mt-3 rounded-xl border border-gray-200 p-3"><summary className="cursor-pointer text-sm font-medium"><span className="mr-2 text-xs text-emerald-700">{b.status === 'sending' ? '配信中' : time(b.scheduledAt)}</span>{b.title}</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-600">{preview(b.messageType, b.messageContent)}</p><Link className="mt-3 flex min-h-11 items-center text-sm text-emerald-700" href="/broadcasts">配信管理を開く →</Link></details>)}
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4"><h2 className="font-bold">AIの返信・返信予定</h2><span className="mt-3 inline-block rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">未連携</span><p className="mt-3 text-sm leading-relaxed text-gray-500">生成済みの返信と送信予定は、AI側のデータ連携後に表示します。送信済みメッセージは個別チャットで確認できます。</p></section>
        <section id="stories" className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-4"><div className="flex items-center justify-between"><h2 className="font-bold">配信中のストーリーズ</h2><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">未連携</span></div><p className="mt-3 text-sm leading-relaxed text-gray-500">ストーリーズの配信元がまだ接続されていません。公開中の内容と終了時刻は、接続後に確認できるようにします。</p></section>
      </div>
    </div>
    <p className="text-center text-xs text-gray-500" aria-live="polite">{loading ? '最新の状況を確認しています…' : `${errors.length ? '最終取得試行' : '最終更新'} ${updated || '—'} · 表示中は1分ごとに更新`}</p>
  </div>
}
