import type { ReactNode } from 'react'
import { getPositionBadgeStyle, getPositionColor } from '../../constants/colors'

interface GuardCardProps {
  role: string
  guardName: ReactNode
  task?: string
  dim?: boolean
}

export default function GuardCard({ role, guardName, task, dim }: GuardCardProps) {
  const assigned = !!guardName
  const badgeStyle = getPositionBadgeStyle(task || '—', assigned)
  const dotColor = getPositionColor(task || '—')

  return (
    <div
      className={`card h-16 px-3.5 flex items-center gap-2.5 transition-opacity ${
        dim ? 'shadow-none' : ''
      }`}
    >
      <span className="text-[11px] font-semibold text-text-label shrink-0 max-w-[4.5rem] text-right truncate">{role}</span>
      <span className="text-[15px] font-extrabold text-text-primary flex-1 min-w-0 truncate">
        {guardName || <span className="text-text-label font-medium italic text-sm">לא הוגדר</span>}
      </span>
      <span
        className="text-[13px] font-bold px-2.5 py-1 rounded-full border shrink-0 max-w-[52%] flex items-center gap-1.5"
        style={badgeStyle}
      >
        {/* The hue lives here, not in the text: a solid dot = someone is assigned, a hollow ring = open slot,
            so fill state never depends on color alone. */}
        <span
          aria-hidden="true"
          className="w-2.5 h-2.5 rounded-full shrink-0 box-border"
          style={assigned ? { backgroundColor: dotColor } : { border: `1.5px solid ${dotColor}` }}
        />
        <span className="truncate">{task || '—'}</span>
      </span>
    </div>
  )
}
