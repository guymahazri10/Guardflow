import { useMemo } from 'react'
import { useMyShifts } from '../hooks/useMyShifts'
import { endsNextDay, myShiftsState, sortMyShifts } from '../lib/scheduleImport/myShiftsView'
import { formatIsraelDateLabel, utcIsoToIsraelHHMM } from '../lib/israelTime'
import { SHIFT_CATEGORIES } from '../constants/shifts'
import { AlertIcon, ClipboardIcon } from './ui/StateIcon'

const israelDateOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(iso))

/** The signed-in user's own shifts for the selected week, as a list. */
export function MyShiftsList({ weekStartIso }: { weekStartIso: string }) {
  const query = useMyShifts(weekStartIso)
  const shifts = useMemo(() => sortMyShifts(query.data?.shifts ?? []), [query.data])

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card h-16 animate-pulse" />
        ))}
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div className="card p-6 text-center">
        <div className="w-11 h-11 rounded-full bg-danger-light flex items-center justify-center mx-auto mb-3 text-danger">
          <AlertIcon />
        </div>
        <p className="font-semibold">שגיאה בטעינת המשמרות</p>
        <button type="button" onClick={() => query.refetch()} className="btn-primary px-6 mt-3">נסה שוב</button>
      </div>
    )
  }

  const state = myShiftsState(query.data)
  if (state === 'not_linked') {
    return (
      <div className="card p-6 text-center" role="status">
        <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-text-secondary">
          <ClipboardIcon />
        </div>
        <p className="font-semibold">לא נמצא קישור לחשבון שלך</p>
        <p className="text-sm text-text-secondary mt-1.5">
          כדי להציג את המשמרות שלך, יש לבקש מהמנהל לקשר את החשבון לשם בסידור.
        </p>
      </div>
    )
  }
  if (state === 'needs_identification') {
    return (
      <div className="card p-6 text-center" role="status">
        <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-text-secondary">
          <ClipboardIcon />
        </div>
        <p className="font-semibold">המשמרות האישיות שלך דורשות זיהוי נוסף</p>
        <p className="text-sm text-text-secondary mt-1.5">
          השם שלך בסידור משותף, או מופיע בשיבוצים חופפים, ולכן אי אפשר לדעת בוודאות איזה מהם שלך. אפשר לפנות למנהל. את כל
          השיבוצים אפשר לראות ב״כל הסידור״.
        </p>
      </div>
    )
  }
  if (state === 'no_shifts') {
    return (
      <div className="card p-6 text-center" role="status">
        <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-text-secondary">
          <ClipboardIcon />
        </div>
        <p className="font-semibold">אין לך משמרות בשבוע הזה</p>
      </div>
    )
  }

  return (
    <>
    {query.data.held_back > 0 && (
      <p className="text-xs text-text-secondary mb-2" role="note">
        {query.data.held_back} משמרות בשם שלך חופפות בזמן ולכן לא מוצגות כאן עד שהמנהל יזהה אותן. הן מופיעות ב״כל הסידור״.
      </p>
    )}
    <ol className="flex flex-col gap-2" aria-label="המשמרות שלי">
      {shifts.map((s) => (
        <li key={s.id} className="card px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-text-secondary">{formatIsraelDateLabel(s.work_date)}</div>
            <div className="font-bold">
              {SHIFT_CATEGORIES[s.shift_category].label} · {s.position}
            </div>
            {s.is_manually_edited && <div className="text-[11px] text-text-muted">שובצת בהחלפה</div>}
          </div>
          <div className="text-left shrink-0">
            <div dir="ltr" className="font-semibold">
              {utcIsoToIsraelHHMM(s.starts_at)}–{utcIsoToIsraelHHMM(s.ends_at)}
            </div>
            {endsNextDay(s, israelDateOf) && <div className="text-[11px] text-text-muted">מסתיימת למחרת</div>}
          </div>
        </li>
      ))}
    </ol>
    </>
  )
}
