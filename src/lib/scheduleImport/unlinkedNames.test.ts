import { describe, it, expect } from 'vitest'
import { matchNames } from './matchNames'
import { detectOverlaps } from './detectOverlaps'
import { buildPreviewGrid } from './previewGrid'
import { getPublishBlockers } from './publishGate'
import { findDatedForSlot, effectiveAssignmentName, effectiveAssignmentUserId, indexDatedBySlot } from './boardDatedSync'
import { carryOverLinks, linkAssignmentToUser, linkStateOf, summarizeNames, toPublishPayload, assignmentIdentityKey } from './nameSummary'
import type { NormalizedAssignment } from './types'
import type { ShiftAssignment } from '../scheduleImports'

const WEEK = '2026-10-18'
const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(18 + i).padStart(2, '0')}`)

function a(
  date: string,
  category: NormalizedAssignment['shift_category'],
  kind: NormalizedAssignment['worker_kind'],
  position: string,
  slot: number,
  name: string,
  hours: [string, string] = ['06:45', '15:10'],
): NormalizedAssignment {
  const [sh, sm] = hours[0].split(':').map(Number)
  const [eh, em] = hours[1].split(':').map(Number)
  const day = Number(date.slice(8))
  const crosses = eh < sh
  const utc = (d: number, h: number, m: number) => new Date(Date.UTC(2026, 9, d, h - 3, m)).toISOString()
  return {
    work_date: date,
    shift_category: category,
    worker_kind: kind,
    position,
    slot_index: slot,
    starts_at: utc(day, sh, sm),
    ends_at: utc(crosses ? day + 1 : day, eh, em),
    source_name: name,
  }
}

/** A file shaped like the real _10_18 week: 83 assignments, 26 distinct names. */
function eightyThree(): NormalizedAssignment[] {
  const pool = Array.from({ length: 26 }, (_, i) => `עובד ${i + 1}`)
  let n = 0
  const next = () => pool[n++ % pool.length]
  const out: NormalizedAssignment[] = []
  for (const [cat, hrs] of [['morning', ['06:30', '15:00']], ['afternoon', ['14:30', '23:00']], ['night', ['22:30', '07:00']]] as const)
    for (const d of days) out.push(a(d, cat, 'אחמ"ש', 'אחמ"ש', 0, next(), [hrs[0], hrs[1]]))
  for (const d of days) out.push(a(d, 'night', 'מאבטח', 'לילה מאבטח', 0, next(), ['22:45', '07:10']))
  for (const [cat, pos, count] of [
    ['afternoon', 'AB', 7], ['afternoon', 'CD', 5], ['afternoon', 'EFG', 5], ['afternoon', 'רכוב', 5],
    ['morning', 'לובי תחתון', 5], ['morning', 'AB', 5], ['morning', 'CD', 5], ['morning', 'EFG', 5], ['morning', 'רכוב', 5],
  ] as const)
    for (let i = 0; i < count; i++) out.push(a(days[i], cat, 'מאבטח', pos, 0, next(), cat === 'morning' ? ['06:45', '15:10'] : ['14:45', '23:10']))
  for (let i = 0; i < 7; i++) out.push(a(days[i], 'morning', 'מאבטח', 'לובי עליון', 0, next()))
  out.push(a(days[5], 'morning', 'מאבטח', 'לובי עליון', 1, next()))
  return out
}

const noProfiles: { id: string; full_name: string | null }[] = []
const none = new Set<string>()

describe('a file with no matching profiles still shows every assignment', () => {
  const matched = matchNames(eightyThree(), noProfiles)

  it('has 83 assignments, none linked', () => {
    expect(matched).toHaveLength(83)
    expect(matched.every((m) => m.planned_user_id === null && m.match_confidence === 'none')).toBe(true)
  })

  it('puts all 83 into the weekly grid with the original names and hours', () => {
    const grid = buildPreviewGrid(matched, none, WEEK)
    const items = grid.rows.flatMap((r) => r.cells.flat())
    expect(items).toHaveLength(83)
    expect(items.every((i) => i.name !== '' && i.linkState === 'unlinked' && /^\d\d:\d\d–\d\d:\d\d$/.test(i.hours))).toBe(true)
    expect(grid.days).toEqual(days)
  })

  it('counts distinct names, not assignments', () => {
    expect(summarizeNames(matched, none)).toEqual({ assignments: 83, uniqueNames: 26, linkedNames: 0, unlinkedNames: 26 })
  })

  it('does not block publishing', () => {
    const blockers = getPublishBlockers({
      isDirty: false, hasDryRun: true, pendingDeleteCount: 0, confirmedDeleteCount: 0,
      overlapWarnings: [], warnings: [], isAcknowledged: () => true,
    })
    expect(blockers).toEqual([])
  })
})

describe('summary by distinct name', () => {
  it('counts a name that repeats in seven shifts once, but shows it in seven cells', () => {
    const rows = days.map((d) => a(d, 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'שם  חוזר', ['06:30', '15:00']))
    const matched = matchNames(rows, noProfiles)
    expect(summarizeNames(matched, none)).toMatchObject({ assignments: 7, uniqueNames: 1, unlinkedNames: 1 })
    const grid = buildPreviewGrid(matched, none, WEEK)
    expect(grid.rows.find((r) => r.id === 'אחמ"ש|morning|אחמ"ש')!.cells.every((c) => c.length === 1)).toBe(true)
  })

  it('normalises spaces and punctuation for counting without changing the displayed name', () => {
    const rows = [
      a(days[0], 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'דני  כהן'),
      a(days[1], 'morning', 'אחמ"ש', 'אחמ"ש', 0, "דני כהן'"),
    ]
    const matched = matchNames(rows, noProfiles)
    expect(summarizeNames(matched, none).uniqueNames).toBe(1)
    expect(matched.map((m) => m.source_name)).toEqual(['דני  כהן', "דני כהן'"])
  })

  it('splits linked from unlinked by distinct name', () => {
    const profiles = [{ id: 'u1', full_name: 'עובד 1' }]
    const matched = matchNames(eightyThree(), profiles)
    const s = summarizeNames(matched, none)
    expect(s).toMatchObject({ assignments: 83, uniqueNames: 26, linkedNames: 1, unlinkedNames: 25 })
  })
})

describe('suggestions are suggestions only', () => {
  const profiles = [{ id: 'u1', full_name: 'דניאל כהן' }]
  const matched = matchNames([a(days[0], 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'דניאל כהנא')], profiles)

  it('a near match is fuzzy: shown with its suggested account, counted as not linked', () => {
    expect(matched[0].match_confidence).toBe('fuzzy')
    expect(linkStateOf(matched[0], none)).toBe('suggested')
    expect(summarizeNames(matched, none).unlinkedNames).toBe(1)
    const item = buildPreviewGrid(matched, none, WEEK).rows[0].cells[0][0]
    expect(item.linkState).toBe('suggested')
    expect(item.suggestedUserId).toBe('u1')
    expect(item.name).toBe('דניאל כהנא')
  })

  it('is not sent as a link unless the manager confirms it, and never blocks publishing', () => {
    expect(toPublishPayload(matched, none)[0].planned_user_id).toBeNull()
    expect(toPublishPayload(matched, none)[0].source_name).toBe('דניאל כהנא')
    const confirmed = new Set([assignmentIdentityKey(matched[0])])
    expect(toPublishPayload(matched, confirmed)[0].planned_user_id).toBe('u1')
    expect(summarizeNames(matched, confirmed).linkedNames).toBe(1)
  })
})

describe('linking later', () => {
  it('ties an account to an assignment without touching the name from the file', () => {
    const [row] = matchNames([a(days[0], 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'שם מקורי')], noProfiles)
    const linked = linkAssignmentToUser(row, 'u9')
    expect(linked.planned_user_id).toBe('u9')
    expect(linked.source_name).toBe('שם מקורי')
    expect(linkStateOf(linked, none)).toBe('linked')
  })
})

describe('two people with the same name', () => {
  it('two profiles with the same name: no account is guessed, the name stays', () => {
    const profiles = [{ id: 'u1', full_name: 'אורי לוי' }, { id: 'u2', full_name: 'אורי לוי' }]
    const [row] = matchNames([a(days[0], 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'אורי לוי')], profiles)
    expect(row.planned_user_id).toBeNull()
    expect(row.source_name).toBe('אורי לוי')
  })

  it('the same name in two slots stays two assignments, one distinct name', () => {
    const rows = matchNames(
      [
        a(days[0], 'morning', 'מאבטח', 'לובי עליון', 0, 'אורי לוי'),
        a(days[0], 'morning', 'מאבטח', 'לובי עליון', 1, 'אורי לוי'),
      ],
      noProfiles,
    )
    const cell = buildPreviewGrid(rows, none, WEEK).rows.find((r) => r.position === 'לובי עליון')!.cells[0]
    expect(cell.map((c) => c.slotIndex)).toEqual([0, 1])
    expect(summarizeNames(rows, none)).toMatchObject({ assignments: 2, uniqueNames: 1 })
  })

  it('overlapping shifts under one unlinked name are a possible double booking that does not block', () => {
    const rows = [
      a(days[0], 'morning', 'מאבטח', 'AB', 0, 'אורי לוי'),
      a(days[0], 'morning', 'מאבטח', 'CD', 0, 'אורי לוי'),
    ]
    const diff = rows.map((r) => ({ ...r, id: null, planned_user_id: null, actual_user_id: null, actual_name: null }))
    const warnings = detectOverlaps(diff)
    expect(warnings.map((w) => w.kind)).toEqual(['possible_double_booking'])
    expect(
      getPublishBlockers({
        isDirty: false, hasDryRun: true, pendingDeleteCount: 0, confirmedDeleteCount: 0,
        overlapWarnings: warnings, warnings: [], isAcknowledged: () => true,
      }),
    ).toEqual([])
  })

  it('the same linked account in overlapping shifts still blocks', () => {
    const rows = [
      a(days[0], 'morning', 'מאבטח', 'AB', 0, 'אורי לוי'),
      a(days[0], 'morning', 'מאבטח', 'CD', 0, 'אורי לוי'),
    ].map((r) => ({ ...r, id: null, planned_user_id: 'u1', actual_user_id: null, actual_name: null }))
    const warnings = detectOverlaps(rows)
    expect(
      getPublishBlockers({
        isDirty: false, hasDryRun: true, pendingDeleteCount: 0, confirmedDeleteCount: 0,
        overlapWarnings: warnings, warnings: [], isAcknowledged: () => true,
      }),
    ).toEqual(['double_booked'])
  })
})

describe('structural problems still block', () => {
  const base = { isDirty: false, hasDryRun: true, pendingDeleteCount: 0, confirmedDeleteCount: 0, overlapWarnings: [], isAcknowledged: () => false }
  it('over-capacity night guards and unresolved positions', () => {
    expect(
      getPublishBlockers({
        ...base,
        warnings: [
          { kind: 'position_capacity_mismatch', message: 'x' },
          { kind: 'unresolved_position_mapping', message: 'y' },
        ],
      }),
    ).toEqual(['unresolved_position', 'over_capacity'])
  })
  it('a stale preview, a missing dry-run, unconfirmed deletions and unacknowledged unusual hours', () => {
    expect(
      getPublishBlockers({
        ...base, isDirty: true, hasDryRun: false, pendingDeleteCount: 2, confirmedDeleteCount: 1,
        warnings: [{ kind: 'unusual_shift_hours', message: 'z' }],
      }),
    ).toEqual(['stale_preview', 'no_dry_run', 'unconfirmed_deletes', 'unacknowledged_warnings'])
  })
})

describe('Setup / Live read the name from the file when no user is linked', () => {
  const row = (over: Partial<ShiftAssignment> = {}): ShiftAssignment => ({
    id: 'r1', work_date: '2026-10-18', shift_category: 'morning', worker_kind: 'מאבטח', position: 'AB', slot_index: 0,
    starts_at: '2026-10-18T03:45:00.000Z', ends_at: '2026-10-18T12:10:00.000Z', source_name: 'שם מהקובץ',
    planned_user_id: null, actual_user_id: null, actual_name: 'שם מהקובץ', source: 'excel', import_id: 'i',
    is_manually_edited: false, published: true, updated_at: '2026-09-01T00:00:00Z', ...over,
  })

  it('shows source_name with no planned user', () => {
    expect(effectiveAssignmentName(row({ actual_name: null }))).toBe('שם מהקובץ')
    expect(effectiveAssignmentUserId(row())).toBeNull()
  })

  it('finds the unlinked assignment for its board slot', () => {
    const map = indexDatedBySlot([row()], ['אחמ"ש', 'מאבטח 3'], 'morning', '2026-10-18')
    expect(map.get('מאבטח 3')?.source_name).toBe('שם מהקובץ')
    expect(findDatedForSlot([row()], [{ position: 'AB' }], '2026-10-18', 'morning')?.source_name).toBe('שם מהקובץ')
  })

  it('a later link adds the account but the displayed name stays the file name, until a manual swap', () => {
    const linked = row({ planned_user_id: 'u1', actual_user_id: 'u1' })
    expect(effectiveAssignmentName(linked)).toBe('שם מהקובץ')
    expect(effectiveAssignmentUserId(linked)).toBe('u1')
    const swapped = row({ planned_user_id: 'u1', actual_user_id: 'u2', actual_name: 'מחליף', is_manually_edited: true })
    expect(effectiveAssignmentName(swapped)).toBe('מחליף')
  })
})

describe('a re-upload keeps links made earlier', () => {
  const rows = matchNames([a(days[0], 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'רן  כהן'), a(days[1], 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'דני לוי')], noProfiles)
  const existing = [
    { work_date: days[0], shift_category: 'morning', position: 'אחמ"ש', slot_index: 0, source_name: 'רן כהן', planned_user_id: 'u7' },
    // same slot, different name now: the earlier link belonged to someone else
    { work_date: days[1], shift_category: 'morning', position: 'אחמ"ש', slot_index: 0, source_name: 'מישהו אחר', planned_user_id: 'u8' },
  ]

  it('keeps the link when the slot still has the same name, and never rewrites the name', () => {
    const out = carryOverLinks(rows, existing)
    expect(out[0].planned_user_id).toBe('u7')
    expect(out[0].source_name).toBe('רן  כהן')
    expect(linkStateOf(out[0], none)).toBe('linked')
  })

  it('does not carry a link over to a different name', () => {
    expect(carryOverLinks(rows, existing)[1].planned_user_id).toBeNull()
  })

  it('an exact match from this upload is left alone', () => {
    const exact = matchNames([a(days[0], 'morning', 'אחמ"ש', 'אחמ"ש', 0, 'רן כהן')], [{ id: 'u1', full_name: 'רן כהן' }])
    expect(carryOverLinks(exact, existing)[0].planned_user_id).toBe('u1')
  })
})
