'use client'

import { useState } from 'react'
import OperationsDashboard from '@/components/dashboard/operations-dashboard'
import ManagementOverview from '@/components/dashboard/management-overview'

export default function DashboardPage() {
  const [showManagement, setShowManagement] = useState(false)
  return <div className="mx-auto max-w-6xl">
    <OperationsDashboard />
    <button className="mt-6 min-h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-600" aria-expanded={showManagement} onClick={() => setShowManagement(!showManagement)}>
      {showManagement ? '管理メニューを閉じる −' : '友だち追加リンク・管理メニュー ＋'}
    </button>
    {showManagement && <div className="mt-6"><ManagementOverview /></div>}
  </div>
}
