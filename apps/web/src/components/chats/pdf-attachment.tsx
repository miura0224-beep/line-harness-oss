"use client"
import { useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'

export async function pdfMessage(file: File, text: string) {
  const result = await fetchApi<{ success: boolean; data: { url: string }; error?: string }>('/api/files', {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file,
  })
  if (!result.success) throw new Error(result.error || 'PDFのアップロードに失敗しました')
  return [text.trim(), '📎 ' + file.name.replace(/[\r\n]/g, ' '), result.data.url].filter(Boolean).join('\n\n')
}
export default function PdfAttachment({ value, onChange, disabled = false }: {
  value: File | null; onChange: (file: File | null) => void; disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  return <div className="min-w-0">
    <input ref={input} type="file" accept=".pdf,application/pdf" className="hidden" disabled={disabled}
      onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
        if (!/\.pdf$/i.test(file.name)) { setError('PDFファイルを選んでください'); return }
        if (file.size > 10 * 1024 * 1024) { setError('PDFは10MB以下にしてください'); return }
        setError(''); onChange(file)
      }} />
    <button type="button" disabled={disabled} onClick={() => input.current?.click()}
      className="min-h-11 rounded-lg border border-gray-300 px-3 text-base font-medium text-gray-800 disabled:opacity-50">📄 PDFを選択</button>
    {value && <div className="mt-2 rounded-lg bg-slate-100 p-2 text-sm text-slate-900 break-all">
      {value.name}（{(value.size / 1024 / 1024).toFixed(1)}MB）
      <button type="button" disabled={disabled} onClick={() => onChange(null)} className="ml-2 min-h-11 px-2 underline">取り消し</button>
      <p>送信すると、PDFを開くリンクが届きます。</p>
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>
}
