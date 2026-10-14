interface ShiftRingProps {
  /** 0..1, how far through the shift we are. */
  progress: number
  /** Time shown in the middle, already formatted (HH:MM). */
  time: string
  /** Sizing classes for the outer box; the ring scales to fit (default 84px). */
  className?: string
}

const VIEW = 84
const STROKE = 8
const RADIUS = VIEW / 2 - STROKE / 2 - 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Progress ring for the current shift with the clock in the middle. */
export default function ShiftRing({ progress, time, className = 'w-[84px] h-[84px]' }: ShiftRingProps) {
  const percent = Math.round(progress * 100)

  return (
    <div
      role="img"
      aria-label={`השעה ${time}, ${percent}% מהמשמרת עברו`}
      className={`relative shrink-0 ${className}`}
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-full" aria-hidden="true">
        <circle cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-primary-200" />
        <circle
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={`${CIRCUMFERENCE * progress} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-xl lg:text-2xl font-bold text-text-primary tabular-nums"
        dir="ltr"
      >
        {time}
      </span>
    </div>
  )
}
