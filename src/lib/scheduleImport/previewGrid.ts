import type { MatchedAssignment, ShiftCategory, WorkerKind } from './types'
import { addDaysIso, utcIsoToIsraelHHMM } from '../israelTime'
import { MAAVTACH_POSITION_ORDER } from './liveBoardPositions'
import { NIGHT_GUARD_LABEL } from './positions'
import { linkStateOf, type LinkState } from './nameSummary'

export type GridItem = {
  /** the name exactly as read from the file */
  name: string
  /** original hours, Israel local, "HH:MM–HH:MM" */
  hours: string
  slotIndex: number
  linkState: LinkState
  /** index into the assignments array the grid was built from */
  assignmentIndex: number
  /** set while the only link is an unconfirmed suggestion */
  suggestedUserId: string | null
}

export type GridRow = {
  id: string
  kind: WorkerKind
  category: ShiftCategory
  position: string
  /** one array of items per day column */
  cells: GridItem[][]
}

export type PreviewGrid = {
  days: string[]
  rows: GridRow[]
}

const CATEGORIES: ShiftCategory[] = ['morning', 'afternoon', 'night']

/** Rows in the order a manager reads the source table: אחמ"ש per shift, then
 *  the guard posts per shift. A row appears only if it has an assignment —
 *  except אחמ"ש, whose three rows are always shown so a gap is visible. */
function rowOrder(assignments: MatchedAssignment[]): Array<{ kind: WorkerKind; category: ShiftCategory; position: string }> {
  const order: Array<{ kind: WorkerKind; category: ShiftCategory; position: string }> = []
  for (const category of CATEGORIES) order.push({ kind: 'אחמ"ש', category, position: 'אחמ"ש' })
  for (const category of CATEGORIES) {
    const known = category === 'night' ? [...MAAVTACH_POSITION_ORDER.night, NIGHT_GUARD_LABEL] : MAAVTACH_POSITION_ORDER[category]
    for (const position of known) order.push({ kind: 'מאבטח', category, position })
  }
  const seen = new Set(order.map((r) => `${r.kind}|${r.category}|${r.position}`))
  for (const a of assignments) {
    const key = `${a.worker_kind}|${a.shift_category}|${a.position}`
    if (!seen.has(key)) {
      seen.add(key)
      order.push({ kind: a.worker_kind, category: a.shift_category, position: a.position })
    }
  }
  return order
}

/**
 * Builds the weekly review table from the assignments. Every assignment lands
 * in exactly one cell — nothing is dropped for lacking a user link — and a
 * cell with two workers holds two items, ordered by slot_index.
 */
export function buildPreviewGrid(
  assignments: MatchedAssignment[],
  confirmedFuzzy: ReadonlySet<string>,
  weekStart: string | null,
): PreviewGrid {
  const dateSet = new Set(assignments.map((a) => a.work_date))
  const days = weekStart ? Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)) : []
  for (const d of [...dateSet].sort()) if (!days.includes(d)) days.push(d)
  if (!weekStart) days.sort()

  const present = new Set(assignments.map((a) => `${a.worker_kind}|${a.shift_category}|${a.position}`))
  const rows: GridRow[] = []
  for (const r of rowOrder(assignments)) {
    const key = `${r.kind}|${r.category}|${r.position}`
    if (r.kind !== 'אחמ"ש' && !present.has(key)) continue
    rows.push({ id: key, ...r, cells: days.map(() => []) })
  }
  const rowById = new Map(rows.map((r) => [r.id, r]))

  assignments.forEach((a, index) => {
    const row = rowById.get(`${a.worker_kind}|${a.shift_category}|${a.position}`)
    const col = days.indexOf(a.work_date)
    if (!row || col < 0) return
    const state = linkStateOf(a, confirmedFuzzy)
    row.cells[col].push({
      name: a.source_name ?? '',
      hours: `${utcIsoToIsraelHHMM(a.starts_at)}–${utcIsoToIsraelHHMM(a.ends_at)}`,
      slotIndex: a.slot_index,
      linkState: state,
      assignmentIndex: index,
      suggestedUserId: state === 'suggested' ? (a.suggested_user_id ?? null) : null,
    })
  })
  for (const row of rows) for (const cell of row.cells) cell.sort((x, y) => x.slotIndex - y.slotIndex)

  return { days, rows }
}
