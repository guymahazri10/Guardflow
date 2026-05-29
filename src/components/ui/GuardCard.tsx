import { getPositionColor } from '../../constants/colors';

interface GuardCardProps {
  role: string;
  guardName: string | null;
  task?: string;
  highlight?: boolean;
}

export default function GuardCard({ role, guardName, task, highlight }: GuardCardProps) {
  const badgeColor = getPositionColor(role);
  const isEmpty = !guardName;

  return (
    <div
      className={`card p-4 transition-shadow ${
        highlight ? 'ring-2 ring-primary/20 shadow-card-md' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Role badge */}
        <span
          className="text-xs font-bold px-2.5 py-1 rounded-badge text-white shrink-0"
          style={{ backgroundColor: badgeColor }}
        >
          {role}
        </span>

        {/* Task label */}
        {task && (
          <span className="text-xs text-text-muted bg-background px-2 py-0.5 rounded-full truncate">
            {task}
          </span>
        )}
      </div>

      <div className="mt-3 min-h-[28px] flex items-center">
        {isEmpty ? (
          <span className="text-text-muted text-sm italic">לא הוגדר</span>
        ) : (
          <span className="text-text-primary font-semibold text-lg leading-tight">{guardName}</span>
        )}
      </div>
    </div>
  );
}
