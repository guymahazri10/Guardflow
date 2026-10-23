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
import { computeTimes, defaultShiftHours, findOverlaps, isPastDate, resolveWorkerAccount } from '../lib/scheduleImport/editPlan'
import { personNameKey } from '../lib/scheduleImport/matchNames'
import { SHIFT_CATEGORIES, type ShiftCategory } from '../constants/shifts'
import { addDaysIso, formatIsraelDateLabel, utcIsoToIsraelHHMM } from '../lib/israelTime'

/**
 * The manager's one small dialog for a slot of the weekly schedule: change who works it, or
 * remove them. Position, shift and hours are shown, not edited here.
 *
 * Behind the scenes the protections stay: every save names the version of the row it saw (a change
 * by someone else in the meantime is refused, not overwritten), every change is written to the
 * history with before/after, a past shift needs a reason, and removing keeps the row as a
 * cancelled marker (so a re-upload of the Excel cannot bring the shift back by itself).
 */
export type WorkerDialogTarget =
  | { type: 'edit'; assignment: ShiftAssignment }
  | {
      type: 'empty'
      workDate: string
      category: ShiftCategory
      position: string
      workerKind: 'אחמ"ש' | 'מאבטח'
      slotIndex: number
      /** an earlier, removed shift in this slot: its hours are reused, and it can be restored */
      removed?: ShiftAssignment
    }

function todayIsrael(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
}

const LRI = '⁦'
const PDI = '⁩'

function hoursText(startsAt: string, endsAt: string, workDate: string): string {
  const endDate = new Date(endsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
  const next = endDate > workDate
  return `${LRI}${utcIsoToIsraelHHMM(startsAt)}–${utcIsoToIsraelHHMM(endsAt)}${PDI}${next ? ` (מסתיימת ב־${formatIsraelDateLabel(endDate)})` : ''}`
}

const KIND_LABEL: Record<string, string> = {
  manual_edit: 'עריכה',
  manual_add: 'הוספה',
  manual_cancel: 'הסרה',
  manual_restore: 'שחזור',
  manual_move: 'העברה',
  manual_replace: 'החלפת עובד',
  import_insert: 'ייבוא',
  import_update: 'עדכון מייבוא',
  import_kept_manual: 'נשמר ידנית בייבוא',
  import_revert_to_file: 'חזרה לקובץ',
}

export function ShiftWorkerDialog({
  target,
  weekAssignments,
  onClose,
}: {
  target: WorkerDialogTarget
  weekAssignments: ShiftAssignment[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const profiles = useMemo(
    () => (profilesQuery.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name, email: p.email })),
    [profilesQuery.data],
  )
  const original = target.type === 'edit' ? target.assignment : null
  const currentName = original ? (original.actual_name ?? original.source_name ?? '') : ''
  const workDate = original ? original.work_date : target.type === 'empty' ? target.workDate : ''
  const category: ShiftCategory = original ? original.shift_category : target.type === 'empty' ? target.category : 'morning'
  const position = original ? original.position : target.type === 'empty' ? target.position : ''
  const workerKind = original ? original.worker_kind : target.type === 'empty' ? target.workerKind : 'מאבטח'
  const removed = target.type === 'empty' ? target.removed : undefined

  const [text, setText] = useState(currentName)
  const [pickedId, setPickedId] = useState<string | null>(original?.actual_user_id ?? null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [reason, setReason] = useState('')
  const [overlapAck, setOverlapAck] = useState(false)
  const [mode, setMode] = useState<'edit' | 'confirm-remove'>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const historyQuery = useQuery({
    queryKey: ['assignment-history', original?.id],
    queryFn: () => fetchAssignmentHistory(original!.id),
    enabled: showHistory && !!original,
  })

  // hours: shown as information. An empty slot reuses the removed shift's hours, else the standard ones.
  const times = useMemo(() => {
    if (original) return { startsAt: original.starts_at, endsAt: original.ends_at }
    if (removed) return { startsAt: removed.starts_at, endsAt: removed.ends_at }
    const d = defaultShiftHours(category, workerKind)
    const t = computeTimes(workDate, d.start, d.end)
    return t ? { startsAt: t.startsAt, endsAt: t.endsAt } : null
  }, [original, removed, category, workerKind, workDate])

  const account = resolveWorkerAccount(text, pickedId, profiles)
  const trimmed = text.trim()
  const past = isPastDate(workDate, todayIsrael())

  const suggestions = useMemo(() => {
    const q = personNameKey(trimmed)
    if (!q || (pickedId && q === personNameKey(profiles.find((p) => p.id === pickedId)?.full_name))) return []
    return profiles
      .filter((p) => personNameKey(p.full_name).includes(q))
      .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'he'))
      .slice(0, 6)
  }, [trimmed, pickedId, profiles])

  // two accounts with the same full name: show the email so the right one can be picked
  const dupNames = useMemo(() => {
    const seen = new Map<string, number>()
    for (const p of profiles) seen.set(personNameKey(p.full_name), (seen.get(personNameKey(p.full_name)) ?? 0) + 1)
    return seen
  }, [profiles])

  const overlaps = useMemo(
    () =>
      times && trimmed
        ? findOverlaps(weekAssignments, { id: original?.id, startsAt: times.startsAt, endsAt: times.endsAt, userId: account.userId, name: trimmed })
        : [],
    [weekAssignments, times, original?.id, account.userId, trimmed],
  )

  const changed = original ? trimmed !== currentName || account.userId !== original.actual_user_id : true
  const reasonMissing = past && !reason.trim()
  const canSave = !!trimmed && changed && !busy && !stale && !reasonMissing && (overlaps.length === 0 || overlapAck)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await Promise.all(
        [['shift-assignments'], ['my-shifts'], ['assignment-history'], ['cancelled-slots']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
      onClose()
    } catch (e) {
      const err = e instanceof ScheduleEditError ? e : null
      setError(err?.message ?? 'הפעולה נכשלה. נסה שוב.')
      if (err?.kind === 'concurrent' || err?.kind === 'cancelled' || err?.kind === 'occupied') {
        setStale(true)
        await queryClient.invalidateQueries({ queryKey: ['shift-assignments'] })
      }
      setMode('edit')
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (!canSave || !times) return
    if (original) {
      return run(() =>
        editShiftAssignment({
          id: original.id,
          expectedUpdatedAt: original.updated_at,
          changes: { worker: { user_id: account.userId, name: trimmed } },
          reason: reason.trim() || null,
        }),
      )
    }
    return run(() =>
      addShiftAssignment({
        workDate,
        shiftCategory: category,
        workerKind,
        position,
        slotIndex: target.type === 'empty' ? target.slotIndex : 0,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        worker: { userId: account.userId, name: trimmed },
        reason: reason.trim() || null,
      }),
    )
  }

  const title = original ? 'עדכון שיבוץ' : 'הוספת עובד לשיבוץ'
  const endsNext = times ? new Date(times.endsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }) > workDate : false

  return (
    <div dir="rtl" role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-extrabold">{title}</h2>
          <button type="button" className="text-sm text-text-secondary" onClick={onClose} aria-label="סגור">✕</button>
        </div>

        {/* information only */}
        <div className="mb-3 rounded-xl bg-background-2 p-2.5 text-sm">
          <div className="font-semibold">{formatIsraelDateLabel(workDate)}</div>
          <div className="text-text-secondary">
            {SHIFT_CATEGORIES[category].label} · {position}
          </div>
          {times && (
            <div className="text-text-secondary">
              {hoursText(times.startsAt, times.endsAt, workDate)}
              {endsNext && <span className="ms-1 text-xs"> · משמרת לילה, מסתיימת ב־{formatIsraelDateLabel(addDaysIso(workDate, 1))}</span>}
            </div>
          )}
        </div>

        {mode === 'confirm-remove' && original ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              להסיר את <b>{currentName || '—'}</b> מהשיבוץ? המשבצת תישאר ריקה ואפשר להוסיף לה שם בהמשך.
            </p>
            {past && (
              <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
                סיבה (חובה — המשמרת כבר עברה)
                <input className="rounded-xl border border-border px-3 py-2 text-sm font-normal text-text-primary" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            )}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-danger px-4 py-2 font-bold text-white disabled:opacity-50"
                disabled={busy || reasonMissing}
                onClick={() => run(() => cancelShiftAssignment({ id: original.id, expectedUpdatedAt: original.updated_at, reason: reason.trim() || null }))}
              >
                {busy ? 'מסיר…' : 'הסר'}
              </button>
              <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={() => setMode('edit')}>
                חזרה
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative flex flex-col gap-1">
              <label htmlFor="worker-name" className="text-xs font-bold text-text-secondary">שם העובד</label>
              <input
                id="worker-name"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm"
                value={text}
                autoComplete="off"
                autoFocus
                role="combobox"
                aria-expanded={showSuggestions && suggestions.length > 0}
                aria-controls="worker-suggestions"
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => {
                  setText(e.target.value)
                  setPickedId(null)
                  setShowSuggestions(true)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void save()
                  }
                }}
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul id="worker-suggestions" role="listbox" className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-white shadow-lg">
                  {suggestions.map((p) => (
                    <li key={p.id} role="option" aria-selected={pickedId === p.id}>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-right text-sm hover:bg-primary-light"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setText(p.full_name ?? '')
                          setPickedId(p.id)
                          setShowSuggestions(false)
                        }}
                      >
                        {p.full_name}
                        {(dupNames.get(personNameKey(p.full_name)) ?? 0) > 1 && p.email && <span className="ms-2 text-xs text-text-muted">{p.email}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {trimmed && (
                <p className="text-[11px] text-text-muted" aria-live="polite">
                  {account.userId
                    ? `מקושר לחשבון: ${profiles.find((p) => p.id === account.userId)?.full_name ?? ''} — השיבוץ יופיע ב״המשמרות שלי״ שלו`
                    : 'שם שאינו מקושר לחשבון (לא ייחשב ב״המשמרות שלי״ של אף אחד)'}
                </p>
              )}
            </div>

            {past && (
              <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
                סיבת השינוי (חובה — המשמרת כבר עברה)
                <input className="rounded-xl border border-border px-3 py-2 text-sm font-normal text-text-primary" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            )}

            {overlaps.length > 0 && (
              <div className="rounded-xl bg-warning-light p-3 text-sm" role="alert">
                <p className="font-bold text-warning">⚠ אותו עובד משובץ בשעות חופפות:</p>
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

            {error && <p className="text-sm text-danger" role="alert">{error}</p>}

            <div className="flex flex-wrap gap-2">
              {stale ? (
                <button type="button" className="btn-primary flex-1 px-4 py-2" onClick={onClose}>
                  סגור ורענן
                </button>
              ) : (
                <button type="button" className="btn-primary flex-1 px-4 py-2" disabled={!canSave} onClick={() => void save()}>
                  {busy ? 'שומר…' : 'שמור'}
                </button>
              )}
              {original && !stale && (
                <button type="button" className="rounded-xl border border-danger px-3 py-2 text-sm font-semibold text-danger" onClick={() => setMode('confirm-remove')}>
                  הסר מהשיבוץ
                </button>
              )}
              {!original && removed && !stale && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-2 text-sm"
                  disabled={busy || (past && !reason.trim())}
                  onClick={() => run(() => restoreShiftAssignment({ id: removed.id, expectedUpdatedAt: removed.updated_at, reason: reason.trim() || null }))}
                >
                  שחזר את {removed.actual_name ?? removed.source_name ?? 'השיבוץ הקודם'}
                </button>
              )}
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
      </div>
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
    return `${LRI}${s.starts_at ? utcIsoToIsraelHHMM(String(s.starts_at)) : '—'}–${s.ends_at ? utcIsoToIsraelHHMM(String(s.ends_at)) : '—'}${PDI} · ${s.position ?? ''} · ${s.actual_name ?? s.source_name ?? '—'}`
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
