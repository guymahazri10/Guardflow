interface ShiftRingProps {
  /** 0..1, how far through the shift we are. */
  progress: number
  /** Time shown in the middle, already formatted (HH:MM). */
  time: string
  size?: number
}

/** Progress ring for the current shift with the clock in the middle. */
export default function ShiftRing({ progress, time, size = 84 }: ShiftRingProps) {
  const stroke = 8
  const radius = size / 2 - stroke / 2 - 2
  const circumference = 2 * Math.PI * radius
  const percent = Math.round(progress * 100)

  return (
    <div
      role="img"
      aria-label={`השעה ${time}, ${percent}% מהמשמרת עברו`}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-primary-200" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={`${circumference * progress} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-xl font-bold text-text-primary tabular-nums"
        dir="ltr"
      >
        {time}
      </span>
    </div>
  )
}
