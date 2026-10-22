import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useProfiles } from '../hooks/useProfiles'
import {
  fetchPublishedSchedulePeople,
  fetchScheduleWorkerLinks,
  linkScheduleWorker,
  unlinkScheduleWorker,
} from '../lib/scheduleWorkerLinks'
import { classifyScheduleNames, type NameStatus, type ScheduleNameRow } from '../lib/scheduleImport/workerNames'

const keys = { links: ['schedule-worker-links'] as const, people: ['schedule-people'] as const }

const STATUS_LABEL: Record<NameStatus, string> = {
  ambiguous: 'עמום — דרושה הכרעה',
  unlinked: 'לא מקושר',
  marked_ambiguous: 'שם משותף — לא משויך',
  explicit: 'מקושר',
  exact: 'שם זהה (אוטומטי)',
}

/**
 * Manager-only screen: a one-time, explicit decision per name in the schedule
 * — which account it is, or "do not attribute". Nothing here changes a name
 * from the file or any assignment; it only decides who "My shifts" shows a
 * shift to. A similar name is offered as a suggestion and never applied by
 * itself.
 */
export function ScheduleLinksPage() {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const peopleQuery = useQuery({ queryKey: keys.people, queryFn: fetchPublishedSchedulePeople })
  const linksQuery = useQuery({ queryKey: keys.links, queryFn: fetchScheduleWorkerLinks })

  const profiles = useMemo(
    () => (profilesQuery.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name })),
    [profilesQuery.data],
  )
  const rows = useMemo(
    () => classifyScheduleNames(peopleQuery.data ?? [], profiles, linksQuery.data ?? []),
    [peopleQuery.data, profiles, linksQuery.data],
  )

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: keys.links })
    queryClient.invalidateQueries({ queryKey: ['my-shifts'] })
  }
  const link = useMutation({
    mutationFn: ({ name, userId }: { name: string; userId: string | null }) => linkScheduleWorker(name, userId),
    onSuccess: refresh,
  })
  const unlink = useMutation({ mutationFn: (name: string) => unlinkScheduleWorker(name), onSuccess: refresh })

  const loading = peopleQuery.isLoading || linksQuery.isLoading || profilesQuery.isLoading
  const failed = peopleQuery.isError || linksQuery.isError || profilesQuery.isError
  const needDecision = rows.filter((r) => r.status === 'ambiguous' || r.status === 'unlinked')
  const decided = rows.filter((r) => r.status !== 'ambiguous' && r.status !== 'unlinked')

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full lg:max-w-4xl">
      <div className="page-header flex items-center justify-between">
        <h1 className="text-lg">
          <span className="font-light text-text-secondary">קישור עובדים</span> <b className="font-extrabold">לסידור</b>
        </h1>
        <Link to="/schedule-import" className="text-sm text-primary font-semibold">חזרה לייבוא</Link>
      </div>
      <div className="p-4 flex flex-col gap-4 pb-24">
        <p className="text-sm text-text-secondary">
          קישור קובע רק למי יוצגו משמרות ב״המשמרות שלי״. השם מהקובץ לא משתנה, והקישור לא משפיע על העלאה, הצגה או פרסום.
          שם דומה מוצע כהצעה בלבד.
        </p>
        {loading ? (
          <div className="card p-6 text-center text-sm text-text-secondary">טוען…</div>
        ) : failed ? (
          <div className="card p-6 text-center text-sm text-danger">שגיאה בטעינה. ייתכן שהמיגרציה עדיין לא הוחלה.</div>
        ) : (
          <>
            <Section title={`דורשים הכרעה (${needDecision.length})`} empty="אין שמות הדורשים הכרעה.">
              {needDecision.map((r) => (
                <NameCard key={r.key} row={r} profiles={profiles} busy={link.isPending || unlink.isPending}
                  onLink={(userId) => link.mutate({ name: r.displayName, userId })} onUnlink={() => unlink.mutate(r.displayName)} />
              ))}
            </Section>
            <Section title={`הוכרעו / מקושרים (${decided.length})`} empty="עדיין אין.">
              {decided.map((r) => (
                <NameCard key={r.key} row={r} profiles={profiles} busy={link.isPending || unlink.isPending}
                  onLink={(userId) => link.mutate({ name: r.displayName, userId })} onUnlink={() => unlink.mutate(r.displayName)} />
              ))}
            </Section>
            {(link.isError || unlink.isError) && <p className="text-sm text-danger" role="alert">הפעולה נכשלה. נסה שוב.</p>}
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-bold text-text-secondary">{title}</h2>
      {children.length === 0 ? <div className="card p-4 text-sm text-text-muted">{empty}</div> : children}
    </section>
  )
}

function NameCard({
  row,
  profiles,
  busy,
  onLink,
  onUnlink,
}: {
  row: ScheduleNameRow
  profiles: { id: string; full_name: string | null }[]
  busy: boolean
  onLink: (userId: string | null) => void
  onUnlink: () => void
}) {
  const [selected, setSelected] = useState<string>(row.userId ?? row.suggestedUserId ?? '')
  const nameOf = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? '—'
  const decidedByManager = row.status === 'explicit' || row.status === 'marked_ambiguous'

  return (
    <div className="card p-3.5 flex flex-col gap-2" data-status={row.status}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold">{row.displayName}</div>
          <div className="text-xs text-text-secondary">
            {row.shifts} משמרות{row.spellings.length > 1 ? ` · ${row.spellings.length} כתיבים` : ''}
          </div>
        </div>
        <span className="text-xs font-semibold rounded-full bg-primary-light px-2 py-1 whitespace-nowrap">{STATUS_LABEL[row.status]}</span>
      </div>

      {row.status === 'ambiguous' && (
        <p className="text-xs text-danger">
          {row.reason === 'duplicate_accounts'
            ? 'שני חשבונות נושאים את השם הזה — אין לנחש. בחר חשבון, או סמן "שם משותף".'
            : 'השם מופיע בשיבוצים שחופפים בזמן. חפיפה היא סימן לבדיקה ולא הוכחה — ייתכן שני אנשים באותו שם, וייתכן אדם אחד. בחר חשבון, או סמן "שם משותף".'}
        </p>
      )}
      {row.status === 'unlinked' && row.reason === 'overlapping_rows' && (
        <p className="text-xs text-danger">השם מופיע בשיבוצים חופפים — סימן לבדיקה, לא הוכחה.</p>
      )}
      {row.status === 'unlinked' && row.suggestedUserId && !selected && (
        <p className="text-xs text-text-secondary">הצעה (לא הוחלה): {nameOf(row.suggestedUserId)}</p>
      )}
      {row.status === 'marked_ambiguous' && (
        <p className="text-xs text-text-secondary">
          סומן כשם משותף לכמה עובדים: המשמרות האישיות לפי השם הזה דורשות זיהוי נוסף ולכן לא יוצגו ב״המשמרות שלי״ לאף אחד.
          כל השיבוצים נשארים ב״כל הסידור״ ולא השתנו.
        </p>
      )}
      {(row.status === 'explicit' || row.status === 'exact') && (
        <p className="text-xs text-text-secondary">חשבון: {nameOf(row.userId)}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="flex-1 min-w-[10rem] rounded-xl border border-border bg-white px-2 py-2 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label={`חשבון עבור ${row.displayName}`}
        >
          <option value="">בחר חשבון…</option>
          {row.suggestedUserId && <option value={row.suggestedUserId}>הצעה: {nameOf(row.suggestedUserId)}</option>}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name ?? p.id}</option>
          ))}
        </select>
        <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={!selected || busy} onClick={() => onLink(selected)}>
          קשר
        </button>
        <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={() => onLink(null)} title="שני עובדים או יותר חולקים את השם הזה בסידור">
          שם משותף
        </button>
        {decidedByManager && (
          <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={onUnlink}>
            בטל החלטה
          </button>
        )}
      </div>
    </div>
  )
}
