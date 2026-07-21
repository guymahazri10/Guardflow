import { getPositionBadgeStyle } from '../../constants/colors'

interface GuardCardProps {
  role: string
  guardName: string | null
  task?: string
  dim?: boolean
}

export default function GuardCard({ role, guardName, task, dim }: GuardCardProps) {
  const assigned = !!guardName
  const badgeStyle = getPositionBadgeStyle(task || '—', assigned)

  return (
    <div
      className={`card h-16 px-3.5 flex items-center gap-2.5 transition-opacity ${
        dim ? 'opacity-45 shadow-none' : ''
      }`}
    >
      <span className="text-[11px] font-semibold text-text-muted shrink-0 max-w-[4.5rem] text-right truncate">{role}</span>
      <span className="text-[15px] font-extrabold text-text-primary flex-1 min-w-0 truncate">
        {guardName || <span className="text-text-muted font-medium italic text-sm">לא הוגדר</span>}
      </span>
      <span
        className="text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 max-w-[9rem] truncate"
        style={badgeStyle}
      >
        {task || '—'}
      </span>
    </div>
  )
}
