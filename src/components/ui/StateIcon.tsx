/** Line icons for empty/error/loading states — replaces emoji per design.md. */

type IconProps = { className?: string }

const shared = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function ClipboardIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  )
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M12 3 2 20h20L12 3z" />
      <line x1="12" y1="10" x2="12" y2="15" />
      <line x1="12" y1="17.5" x2="12" y2="17.6" />
    </svg>
  )
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

export function UploadIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5.5-5.5a2 2 0 0 0-2.83 0L3 20" />
    </svg>
  )
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.3 2.3L15.5 9" />
    </svg>
  )
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  )
}
