import { describe, it, expect } from 'vitest'
import { normalizeSchedule } from './normalizeSchedule'
import { matchNames } from './matchNames'
import { validateSchedule } from './validateSchedule'
import type { RawGrid } from './types'

function cell(text: string, entries: string[] = [text]) {
  return { text, entries: entries.filter((e) => e.trim().length > 0) }
}

const weekStart = new Date('2026-09-06T00:00:00.000Z')
const profiles = [{ id: 'u1', full_name: 'בדיקה־א׳' }]

function runPipeline(grid: RawGrid, existing: Parameters<typeof validateSchedule>[1] = []) {
  const { assignments: normalized } = normalizeSchedule(grid, weekStart)
  const matched = matchNames(normalized, profiles)
  return validateSchedule(matched, existing)
}

describe('re-upload composition', () => {
  it('produces an identical assignment set for two identical uploads (idempotency at the pipeline level)', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער'), cell('08:00-14:00 בדיקה־א׳')],
      ],
    }
    const first = runPipeline(grid)
    const second = runPipeline(grid)
    expect(second.assignments).toEqual(first.assignments)
    expect(second.stats).toEqual(first.stats)
  })

  it('flags a conflict for a corrected re-upload against a manually-edited existing row, but produces the same non-conflicting rows otherwise', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער'), cell('08:00-14:00 בדיקה־א׳')],
        [cell('שער 2'), cell('08:00-14:00 בדיקה־א׳')],
      ],
    }
    const existing = [
      { work_date: '2026-09-06', shift_category: 'morning', position: 'שער', slot_index: 0, is_manually_edited: true },
    ]
    const result = runPipeline(grid, existing)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].position).toBe('שער')
    expect(result.assignments).toHaveLength(2) // both rows still appear in the diff; only 'שער' is flagged
  })
})
