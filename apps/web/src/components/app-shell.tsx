'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import MobileNav from './layout/mobile-nav'
import { UpdateBanner } from './update/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider, useAccount } from '@/contexts/account-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <AccountProvider>
        <div className="flex min-h-screen flex-col">
          {/* Phase 6: banner above sidebar+header so it pins to the top of the
              admin shell. Renders nothing while loading; one of latest/fork/
              upgrade once /admin/version + manifest resolve. */}
          <UpdateBanner />
          <div className="flex flex-1 min-h-0">
            <Sidebar />
            <main className={`app-main min-w-0 flex-1 overflow-auto pt-[72px] lg:pt-0 ${pathname === "/chats" ? "line-chat-page" : ""}`}>
              <div className="app-content px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">
                <AccountContent>{children}</AccountContent>
              </div>
            </main>
            <MobileNav />
          </div>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}

// Account changes must unmount page state and invalidate all old async callbacks.
// Do not mount a page until a concrete account is selected: omission means "all" in APIs.
function AccountContent({ children }: { children: React.ReactNode }) {
  const { loading, selectedAccountId } = useAccount()
  if (loading) return <p role="status">アカウントを読み込み中…</p>
  if (!selectedAccountId) return <p role="alert">LINEアカウントを選択してください。</p>
  return <div key={selectedAccountId}>{children}</div>
}
