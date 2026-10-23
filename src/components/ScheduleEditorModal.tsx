import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useProfiles } from '../hooks/useProfiles'
import {
  ScheduleEditError,
  addShiftAssignment,
  cancelShiftAssignment,
  editShiftAssignment,
  fetchAssignmentHistory,
  restoreShiftAssignment,
  type AssignmentHistoryEntry,
} from '../lib/scheduleEdits'
import type { ShiftAssignment } from '../lib/scheduleImports'
import {
  buildChanges,
  computeTimes,
  describeEdit,
  draftFromAssignment,
  findOverlaps,
  isPastDate,
  validateDraft,
  type EditDraft,
} from '../lib/scheduleImport/editPlan'
import { allKnownPositionsForCategory } from '../lib/scheduleImport/liveBoardPositions'
import { NIGHT_GUARD_ROLE } from '../lib/scheduleImport/positions'
import { SHIFT_CATEGORIES, type ShiftCategory } from '../constants/shifts'
import { formatIsraelDateLabel, utcIsoToIsraelHHMM } from '../lib/israelTime'

export type EditorTarget =
  | { type: 'edit'; assignment: ShiftAssignment }
  | { type: 'restore'; assignment: ShiftAssignment }
  | { type: 'add'; workDate: string; category: ShiftCategory; position: string; workerKind: 'אחמ"ש' | 'מאבטח'; slotIndex: number }

const CATEGORY_ORDER: ShiftCategory[] = ['morning', 'afternoon', 'night']
const OTHER = '__other__'

function todayIsrael(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
}
function pad(n: number) {
  return String(n).padStart(2, '0')
}
function hoursOf(a: ShiftAssignment) {
  return `${utcIsoToIsraelHHMM(a.starts_at)}–${utcIsoToIsraelHHMM(a.ends_at)}`
}
const KIND_LABEL: Record<string, string> = {
  manual_edit: 'עריכה',
  manual_add: 'הוספה',
  manual_cancel: 'ביטול',
  manual_restore: 'שחזור',
  manual_move: 'העברה',
  manual_replace: 'החלפת עובד',
  import_insert: 'ייבוא',
  import_update: 'עדכון מייבוא',
  import_kept_manual: 'נשמר ידנית בייבוא',
  import_revert_to_file: 'חזרה לקובץ',
}

export function ScheduleEditorModal({
  target,
  weekAssignments,
  onClose,
  onSaved,
}: {
  target: EditorTarget
  weekAssignments: ShiftAssignment[]
  onClose: () => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const profiles = useMemo(
    () => [...(profilesQuery.data ?? [])].sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'he')),
    [profilesQuery.data],
  )
  const original = target.type === 'add' ? null : target.assignment
  const workerKind = target.type === 'add' ? target.workerKind : target.assignment.worker_kind

  const [draft, setDraft] = useState<EditDraft>(() => {
    if (target.type !== 'add') return draftFromAssignment(target.assignment)
    const cat = SHIFT_CATEGORIES[target.category]
    return {
      workDate: target.workDate,
      category: target.category,
      position: target.position,
      slotIndex: target.slotIndex,
      startTime: `${pad(cat.startHour)}:00`,
      endTime: `${pad(cat.endHour)}:00`,
      worker: { kind: 'free', name: '' },
    }
  })
  const [step, setStep] = useState<'form' | 'confirm' | 'cancel' | 'restore'>(target.type === 'restore' ? 'restore' : 'form')
  const [reason, setReason] = useState('')
  const [overlapAck, setOverlapAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [customPosition, setCustomPosition] = useState(false)

  const historyQuery = useQuery({
    queryKey: ['assignment-history', original?.id],
    queryFn: () => fetchAssignmentHistory(original!.id),
    enabled: showHistory && !!original,
  })

  const isCommanderRow = workerKind === 'אחמ"ש'
  const knownPositions = isCommanderRow ? ['אחמ"ש'] : allKnownPositionsForCategory(draft.category)
  const positions = knownPositions.includes(draft.position) ? knownPositions : [draft.position, ...knownPositions]
  const showSlot = !isCommanderRow && (draft.position === NIGHT_GUARD_ROLE.label || draft.slotIndex > 0)
  const times = computeTimes(draft.workDate, draft.startTime, draft.endTime)
  const problems = validateDraft(draft)
  const past = isPastDate(draft.workDate, todayIsrael())
  const nameOfProfile = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? id

  const proposedWorker = useMemo(() => {
    if (draft.worker.kind === 'account') return { userId: draft.worker.userId, name: draft.worker.name }
    if (draft.worker.kind === 'free') return { userId: null, name: draft.worker.name }
    return { userId: original?.actual_user_id ?? null, name: original?.actual_name ?? original?.source_name ?? '' }
  }, [draft.worker, original])

  const overlaps = useMemo(
    () =>
      times
        ? findOverlaps(weekAssignments, { id: original?.id, startsAt: times.startsAt, endsAt: times.endsAt, userId: proposedWorker.userId, name: proposedWorker.name })
        : [],
    [weekAssignments, times, original?.id, proposedWorker],
  )

  const summary = original ? describeEdit(original, draft) : []
  const changes = original ? buildChanges(original, draft) : {}
  const nothingChanged = original ? Object.keys(changes).length === 0 : false

  function patch(p: Partial<EditDraft>) {
    setDraft((d) => ({ ...d, ...p }))
    setError(null)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['shift-assignments'] })
      await queryClient.invalidateQueries({ queryKey: ['my-shifts'] })
      await queryClient.invalidateQueries({ queryKey: ['assignment-history'] })
      onSaved()
    } catch (e) {
      const err = e instanceof ScheduleEditError ? e : null
      setError(err?.message ?? 'הפעולה נכשלה. נסה שוב.')
      if (err?.kind === 'concurrent' || err?.kind === 'occupied') {
        await queryClient.invalidateQueries({ queryKey: ['shift-assignments'] })
        setStep(err.kind === 'concurrent' ? 'form' : 'confirm')
      }
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (target.type === 'add') {
      if (!times) return
      return run(() =>
        addShiftAssignment({
          workDate: draft.workDate,
          shiftCategory: draft.category,
          workerKind: workerKind,
          position: draft.position,
          slotIndex: draft.slotIndex,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          worker: { userId: proposedWorker.userId, name: proposedWorker.name.trim() },
          reason: reason.trim() || null,
        }),
      )
    }
    if (!original) return
    return run(() => editShiftAssignment({ id: original.id, expectedUpdatedAt: original.updated_at, changes, reason: reason.trim() || null }))
  }

  const reasonMissing = past && !reason.trim()
  const canSave = !busy && !reasonMissing && (overlaps.length === 0 || overlapAck)
  const dateLabel = formatIsraelDateLabel(draft.workDate)
  const title =
    target.type === 'add' ? 'הוספת שיבוץ' : target.type === 'restore' ? 'שחזור שיבוץ' : step === 'cancel' ? 'ביטול שיבוץ' : 'עריכת שיבוץ'

  return (
    <div dir="rtl" role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-extrabold">{title}</h2>
          <button type="button" className="text-sm text-text-secondary" onClick={onClose} aria-label="סגור">✕</button>
        </div>
        <p className="mb-3 text-sm text-text-secondary">
          {dateLabel} · {SHIFT_CATEGORIES[draft.category].label}
        </p>

        {step === 'form' && (
          <div className="flex flex-col gap-3">
            {/* worker */}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-bold text-text-secondary">עובד</legend>
              {original && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="worker" checked={draft.worker.kind === 'keep'} onChange={() => patch({ worker: { kind: 'keep' } })} />
                  ללא שינוי ({original.actual_name ?? original.source_name ?? '—'})
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="worker"
                  checked={draft.worker.kind === 'account'}
                  onChange={() => patch({ worker: { kind: 'account', userId: '', name: '' } })}
                />
                חשבון קיים
              </label>
              {draft.worker.kind === 'account' && (
                <select
                  className="rounded-xl border border-border bg-white px-2 py-2 text-sm"
                  aria-label="בחירת חשבון"
                  value={draft.worker.userId}
                  onChange={(e) => patch({ worker: { kind: 'account', userId: e.target.value, name: e.target.value ? nameOfProfile(e.target.value) : '' } })}
                >
                  <option value="">בחר חשבון…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name ?? p.email ?? p.id}</option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="worker" checked={draft.worker.kind === 'free'} onChange={() => patch({ worker: { kind: 'free', name: '' } })} />
                שם חופשי (ללא חשבון)
              </label>
              {draft.worker.kind === 'free' && (
                <input
                  className="rounded-xl border border-border bg-white px-3 py-2 text-sm"
                  aria-label="שם עובד"
                  placeholder="שם מלא"
                  value={draft.worker.name}
                  onChange={(e) => patch({ worker: { kind: 'free', name: e.target.value } })}
                />
              )}
              <p className="text-[11px] text-text-muted">השם המוצג ובחירת החשבון נפרדים. לא מתבצעת התאמה אוטומטית של שמות.</p>
            </fieldset>

            {/* hours */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
                התחלה
                <input type="time" dir="ltr" className="rounded-xl border border-border px-2 py-2 text-sm font-normal text-text-primary" value={draft.startTime} onChange={(e) => patch({ startTime: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
                סיום
                <input type="time" dir="ltr" className="rounded-xl border border-border px-2 py-2 text-sm font-normal text-text-primary" value={draft.endTime} onChange={(e) => patch({ endTime: e.target.value })} />
              </label>
            </div>
            {times?.crossesMidnight && (
              <p className="rounded-lg bg-primary-light px-2 py-1.5 text-xs font-semibold">
                משמרת לילה: מתחילה ב־{formatIsraelDateLabel(draft.workDate)} ומסתיימת ב־{formatIsraelDateLabel(times.endDate)}.
              </p>
            )}

            {/* shift + post */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
                משמרת
                <select
                  className="rounded-xl border border-border bg-white px-2 py-2 text-sm font-normal text-text-primary"
                  value={draft.category}
                  onChange={(e) => patch({ category: e.target.value as ShiftCategory })}
                >
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>{SHIFT_CATEGORIES[c].label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
                עמדה
                <select
                  className="rounded-xl border border-border bg-white px-2 py-2 text-sm font-normal text-text-primary"
                  disabled={isCommanderRow}
                  value={customPosition ? OTHER : draft.position}
                  onChange={(e) => {
                    if (e.target.value === OTHER) setCustomPosition(true)
                    else {
                      setCustomPosition(false)
                      patch({ position: e.target.value })
                    }
                  }}
                >
                  {positions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                  {!isCommanderRow && <option value={OTHER}>אחר…</option>}
                </select>
              </label>
            </div>
            {customPosition && (
              <input className="rounded-xl border border-border bg-white px-3 py-2 text-sm" aria-label="שם עמדה" placeholder="שם העמדה" value={draft.position} onChange={(e) => patch({ position: e.target.value })} />
            )}
            {showSlot && (
              <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
                מאבטח במקום
                <select className="rounded-xl border border-border bg-white px-2 py-2 text-sm font-normal text-text-primary" value={draft.slotIndex} onChange={(e) => patch({ slotIndex: Number(e.target.value) })}>
                  <option value={0}>1</option>
                  <option value={1}>2</option>
                </select>
              </label>
            )}

            {problems.map((p) => (
              <p key={p} className="text-xs text-danger" role="alert">{p}</p>
            ))}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="btn-primary flex-1 px-4 py-2"
                disabled={problems.length > 0 || nothingChanged || (target.type === 'add' && draft.worker.kind === 'keep')}
                onClick={() => {
                  setOverlapAck(false)
                  setStep('confirm')
                }}
              >
                המשך לסיכום
              </button>
              {original && (
                <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => setStep('cancel')}>
                  ביטול שיבוץ
                </button>
              )}
              <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={onClose}>
                סגור
              </button>
            </div>
            {original && (
              <div className="border-t border-border pt-2">
                <button type="button" className="text-xs font-semibold text-primary" onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? 'הסתר היסטוריית שינויים' : 'היסטוריית שינויים'}
                </button>
                {showHistory && <History entries={historyQuery.data} loading={historyQuery.isLoading} profiles={profiles} />}
              </div>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="flex flex-col gap-3">
            <div className="card flex flex-col gap-2 p-3 text-sm" aria-label="סיכום השינוי">
              {target.type === 'add' ? (
                <>
                  <Line label="פעולה" after="הוספת שיבוץ חדש" />
                  <Line label="עמדה" after={`${SHIFT_CATEGORIES[draft.category].label} · ${draft.position}`} />
                  <Line label="עובד" after={`${proposedWorker.name || '—'}${proposedWorker.userId ? '' : ' (שם חופשי, ללא חשבון)'}`} />
                  <Line label="שעות" after={times ? `${draft.startTime}–${draft.endTime}${times.crossesMidnight ? ` (מסתיימת ב־${formatIsraelDateLabel(times.endDate)})` : ''}` : '—'} />
                </>
              ) : (
                summary.map((l) => <Line key={l.label} label={l.label} before={l.before} after={l.after} />)
              )}
              {times?.crossesMidnight && target.type !== 'add' && (
                <p className="text-xs font-semibold">משמרת לילה — תאריך הסיום: {formatIsraelDateLabel(times.endDate)}</p>
              )}
              <p className="text-[11px] text-text-muted">השינוי חל על שיבוץ זה בלבד, ולא על תבנית המשמרת או על שבועות אחרים. ערכי המקור מהקובץ נשמרים בהיסטוריה.</p>
            </div>

            {overlaps.length > 0 && (
              <div className="rounded-xl bg-warning-light p-3 text-sm" role="alert">
                <p className="font-bold text-warning">⚠ חפיפה בשעות עם משמרות אחרות של אותו עובד:</p>
                <ul className="mt-1 list-disc pr-5 text-xs">
                  {overlaps.map((o) => (
                    <li key={o.id}>{o.dateLabel} · {o.position} · <span dir="ltr">{o.hours}</span></li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                  <input type="checkbox" checked={overlapAck} onChange={(e) => setOverlapAck(e.target.checked)} />
                  אני מאשר את החפיפה
                </label>
              </div>
            )}

            <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
              {past ? 'סיבת השינוי (חובה — המשמרת כבר עברה)' : 'סיבת השינוי (לא חובה)'}
              <textarea className="rounded-xl border border-border px-3 py-2 text-sm font-normal text-text-primary" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className="btn-primary flex-1 px-4 py-2" disabled={!canSave} onClick={save}>
                {busy ? 'שומר…' : 'אשר ושמור'}
              </button>
              <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={() => setStep('form')}>
                חזרה לעריכה
              </button>
              <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={onClose}>
                בטל
              </button>
            </div>
          </div>
        )}

        {step === 'cancel' && original && (
          <div className="flex flex-col gap-3">
            <div className="card flex flex-col gap-1 p-3 text-sm">
              <p className="font-bold">לבטל את השיבוץ הזה?</p>
              <p>{original.actual_name ?? original.source_name ?? '—'} · {SHIFT_CATEGORIES[original.shift_category].label} · {original.position}</p>
              <p dir="ltr" className="text-right">{hoursOf(original)}</p>
              <p className="text-xs text-text-secondary">השיבוץ לא נמחק: הוא נשמר כמבוטל, לא יופיע בסידור, ואפשר לשחזר אותו.</p>
            </div>
            <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
              {isPastDate(original.work_date, todayIsrael()) ? 'סיבה (חובה — המשמרת כבר עברה)' : 'סיבה (לא חובה)'}
              <textarea className="rounded-xl border border-border px-3 py-2 text-sm font-normal text-text-primary" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-danger px-4 py-2 font-bold text-white disabled:opacity-50"
                disabled={busy || (isPastDate(original.work_date, todayIsrael()) && !reason.trim())}
                onClick={() => run(() => cancelShiftAssignment({ id: original.id, expectedUpdatedAt: original.updated_at, reason: reason.trim() || null }))}
              >
                {busy ? 'מבטל…' : 'בטל שיבוץ'}
              </button>
              <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={() => setStep('form')}>
                חזרה
              </button>
            </div>
          </div>
        )}

        {step === 'restore' && original && (
          <div className="flex flex-col gap-3">
            <div className="card flex flex-col gap-1 p-3 text-sm">
              <p className="font-bold">לשחזר את השיבוץ שבוטל?</p>
              <p>{original.actual_name ?? original.source_name ?? '—'} · {SHIFT_CATEGORIES[original.shift_category].label} · {original.position}</p>
              <p dir="ltr" className="text-right">{hoursOf(original)}</p>
              <p className="text-xs text-text-secondary">השיבוץ יחזור בדיוק כפי שהיה, וההיסטוריה שלו תימשך.</p>
            </div>
            <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
              {isPastDate(original.work_date, todayIsrael()) ? 'סיבה (חובה — המשמרת כבר עברה)' : 'סיבה (לא חובה)'}
              <textarea className="rounded-xl border border-border px-3 py-2 text-sm font-normal text-text-primary" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1 px-4 py-2"
                disabled={busy || (isPastDate(original.work_date, todayIsrael()) && !reason.trim())}
                onClick={() => run(() => restoreShiftAssignment({ id: original.id, expectedUpdatedAt: original.updated_at, reason: reason.trim() || null }))}
              >
                {busy ? 'משחזר…' : 'שחזר שיבוץ'}
              </button>
              <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={onClose}>
                סגור
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Line({ label, before, after }: { label: string; before?: string; after: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-bold text-text-secondary">{label}</span>
      {before !== undefined ? (
        <span>
          <span className="text-text-muted line-through">{before}</span> <span aria-hidden="true">←</span> <b>{after}</b>
        </span>
      ) : (
        <b>{after}</b>
      )}
    </div>
  )
}

function History({
  entries,
  loading,
  profiles,
}: {
  entries: AssignmentHistoryEntry[] | undefined
  loading: boolean
  profiles: { id: string; full_name: string | null }[]
}) {
  if (loading) return <p className="mt-2 text-xs text-text-secondary">טוען…</p>
  if (!entries || entries.length === 0) return <p className="mt-2 text-xs text-text-secondary">אין שינויים רשומים.</p>
  const who = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? 'משתמש'
  const snap = (e: AssignmentHistoryEntry, side: 'before' | 'after') => {
    const s = e.details?.[side] as Record<string, string | boolean | null> | undefined
    if (!s) return null
    return `${s.starts_at ? utcIsoToIsraelHHMM(String(s.starts_at)) : '—'}–${s.ends_at ? utcIsoToIsraelHHMM(String(s.ends_at)) : '—'} · ${s.position ?? ''} · ${s.actual_name ?? s.source_name ?? '—'}`
  }
  return (
    <ol className="mt-2 flex flex-col gap-2 text-xs">
      {entries.map((e) => (
        <li key={e.id} className="rounded-lg bg-background-2 p-2">
          <div className="font-bold">{KIND_LABEL[e.change_kind] ?? e.change_kind} · {who(e.changed_by)}</div>
          <div className="text-text-muted">{new Date(e.changed_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</div>
          {e.reason && <div>סיבה: {e.reason}</div>}
          {snap(e, 'before') && <div dir="auto">לפני: {snap(e, 'before')}</div>}
          {snap(e, 'after') && <div dir="auto">אחרי: {snap(e, 'after')}</div>}
        </li>
      ))}
    </ol>
  )
}
