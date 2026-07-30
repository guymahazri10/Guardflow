import { useNavigate } from 'react-router-dom'
import { useShiftTemplates } from '../hooks/useShiftTemplates'
import { getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'

export function ShiftTemplatesPage() {
  const navigate = useNavigate()
  const templatesQuery = useShiftTemplates()
  const shiftTypesQuery = useShiftTypes()

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      <div className="bg-white border-b border-border px-4 pt-5 pb-4">
        <h1 className="text-xl font-bold text-text-primary">תבניות משמרת</h1>
        <p className="text-text-secondary text-sm mt-0.5">בחר תבנית כדי לערוך את תוכן הלוח שלה</p>
      </div>

      {(templatesQuery.isError || shiftTypesQuery.isError) && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          טעינת התבניות נכשלה. נסה לרענן את העמוד.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 pb-6">
        {templatesQuery.isLoading || shiftTypesQuery.isLoading ? (
          <ListSkeleton />
        ) : (
          (shiftTypesQuery.data ?? []).map((shift) => {
            const template = templatesQuery.data?.find((t) => t.shift_id === shift.id)

            return (
              <button
                key={shift.id}
                onClick={() => navigate(`/shift-templates?shiftId=${encodeURIComponent(shift.id)}`)}
                className="card p-3.5 text-right flex items-center gap-3 transition-all active:scale-[0.98]"
              >
                <div className="flex-1 text-right min-w-0">
                  <p className="text-sm font-bold text-text-primary">{getShiftFullTitle(shift)}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {getShiftShortLabel(shift)} · {getShiftHoursLabel(shift)}
                  </p>
                </div>
                <span className="text-[11px] text-text-muted shrink-0">
                  {template ? `${template.cols.length} תפקידים` : '—'}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card p-3.5 flex items-center gap-3 animate-pulse">
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3.5 w-24 bg-border rounded" />
            <div className="h-3 w-32 bg-border rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
