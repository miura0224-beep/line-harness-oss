'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/', label: 'ホーム', path: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z' },
  { href: '/chats', label: 'チャット', path: 'M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z' },
  { href: '/broadcasts', label: '配信', path: 'm3 10 18-7-7 18-3-8-8-3Zm8 3 10-10' },
  { href: '/notifications', label: '未対応', path: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4' },
]
export default function MobileNav() {
  const pathname = usePathname()
  return <nav aria-label="メインナビゲーション" className="mobile-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-gray-200 bg-white/95 backdrop-blur lg:hidden">
    {items.map(item => <Link href={item.href} key={item.href} aria-current={pathname === item.href ? 'page' : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${pathname === item.href ? 'text-emerald-700' : 'text-gray-500'}`}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"><path d={item.path} /></svg>{item.label}</Link>)}
  </nav>
}
