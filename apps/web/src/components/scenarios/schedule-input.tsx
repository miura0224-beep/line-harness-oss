'use client'

import type { DeliveryMode } from '@line-crm/shared'

export interface ScheduleValue {
  delayMinutes: number
  offsetDays: number
  offsetHours: number
  offsetMinutesRemainder: number
  deliveryTime: string
}

export const emptySchedule: ScheduleValue = {
  delayMinutes: 0,
  offsetDays: 0,
  offsetHours: 0,
  offsetMinutesRemainder: 0,
  deliveryTime: '09:00',
}

/**
 * elapsed mode の DB 上の offsetMinutes は 0..1439 なので、
 * UI 側では 時間+分 に分けて編集する。
 */
export function offsetMinutesFromUI(value: ScheduleValue): number {
  return value.offsetHours * 60 + value.offsetMinutesRemainder
}

export function uiFromOffsetMinutes(offsetMinutes: number | null | undefined) {
  const m = offsetMinutes ?? 0
  return { offsetHours: Math.floor(m / 60), offsetMinutesRemainder: m % 60 }
}

interface Props {
  mode: DeliveryMode
  value: ScheduleValue
  onChange: (next: ScheduleValue) => void
}

const inputCls =
  'w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

export default function ScheduleInput({ mode, value, onChange }: Props) {
  if (mode === 'relative') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">遅延 (分)</label>
        <input
          type="number"
          min={0}
          className={inputCls + ' w-full'}
          value={value.delayMinutes}
          onChange={(e) => onChange({ ...value, delayMinutes: Math.max(0, Number(e.target.value) || 0) })}
        />
        <p className="text-xs text-gray-400 mt-0.5">前のステップから</p>
      </div>
    )
  }
  if (mode === 'elapsed') {
    return (
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600">購読開始から</label>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={value.offsetDays}
            onChange={(e) => onChange({ ...value, offsetDays: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span className="text-sm text-gray-700">日</span>
          <input
            type="number"
            min={0}
            max={23}
            className={inputCls}
            value={value.offsetHours}
            onChange={(e) =>
              onChange({ ...value, offsetHours: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })
            }
          />
          <span className="text-sm text-gray-700">時間</span>
          <input
            type="number"
            min={0}
            max={59}
            className={inputCls}
            value={value.offsetMinutesRemainder}
            onChange={(e) =>
              onChange({
                ...value,
                offsetMinutesRemainder: Math.max(0, Math.min(59, Number(e.target.value) || 0)),
              })
            }
          />
          <span className="text-sm text-gray-700">分後に配信</span>
        </div>
      </div>
    )
  }
  // absolute_time
  // 「登録直後」= 0日後の 00:00。computeNextDeliveryAt は過去時刻を now に丸めるので、
  // 何時に登録されても次の cron 実行（最大5分）で即送られる。
  const isImmediate = value.offsetDays === 0 && value.deliveryTime === '00:00'
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-600">配信タイミング</label>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            className="h-4 w-4"
            checked={isImmediate}
            onChange={() => onChange({ ...value, offsetDays: 0, deliveryTime: '00:00' })}
          />
          登録直後に配信（時刻を指定しない）
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            className="h-4 w-4"
            checked={!isImmediate}
            onChange={() => onChange({ ...value, offsetDays: Math.max(1, value.offsetDays || 1), deliveryTime: value.deliveryTime === '00:00' ? '20:00' : value.deliveryTime })}
          />
          日時を指定して配信
        </label>
      </div>
      {isImmediate ? (
        <p className="text-xs text-gray-500">友だち追加・タグ付与の直後に送ります（最大5分の遅れ）。</p>
      ) : (
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={value.offsetDays}
          onChange={(e) => onChange({ ...value, offsetDays: Math.max(0, Number(e.target.value) || 0) })}
        />
        <span className="text-sm text-gray-700">日後の</span>
        <input
          type="time"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          value={value.deliveryTime}
          onChange={(e) => onChange({ ...value, deliveryTime: e.target.value })}
        />
        <span className="text-sm text-gray-700">に配信</span>
      </div>
      )}
      <p className="text-xs text-gray-400">ⓘ cron が 5 分粒度のため最大 5 分遅れる場合があります</p>
    </div>
  )
}

/**
 * ScheduleValue → API リクエストの schedule フィールド (delivery_mode に応じて取捨選択)
 */
export function buildSchedulePayload(mode: DeliveryMode, value: ScheduleValue) {
  if (mode === 'relative') {
    return { delayMinutes: value.delayMinutes }
  }
  if (mode === 'elapsed') {
    return {
      offsetDays: value.offsetDays,
      offsetMinutes: offsetMinutesFromUI(value),
    }
  }
  return {
    offsetDays: value.offsetDays,
    deliveryTime: value.deliveryTime,
  }
}
