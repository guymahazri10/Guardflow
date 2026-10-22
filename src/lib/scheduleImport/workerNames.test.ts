import { describe, expect, it } from 'vitest'
import { classifyScheduleNames } from './workerNames'
import { personNameKey } from './matchNames'
import type { SchedulePerson } from '../scheduleWorkerLinks'

const row = (name: string, start: string, end: string, over: Partial<SchedulePerson> = {}): SchedulePerson => ({
  id: name + start, work_date: start.slice(0, 10), starts_at: start, ends_at: end,
  source_name: name, is_manually_edited: false, published: true, ...over,
})
const d = (day: number, hm: string) => `2031-01-${String(day).padStart(2, '0')}T${hm}:00Z`
const status = (rows: ReturnType<typeof classifyScheduleNames>, name: string) => rows.find((r) => r.key === personNameKey(name))

describe('classifyScheduleNames', () => {
  const profiles = [
    { id: 'a', full_name: 'אורי כהן' },
    { id: 'd1', full_name: 'תמר גל' },
    { id: 'd2', full_name: 'תמר גל' },
    { id: 'g', full_name: 'גיא' },
  ]
  const people = [
    row('אורי כהן', d(5, '04:00'), d(5, '12:00')),
    row('אורי כהן', d(6, '04:00'), d(6, '12:00')),
    row('תמר גל', d(5, '04:00'), d(5, '12:00')),
    row('גיא מהצרי', d(5, '04:00'), d(5, '12:00')),
    row('שם חדש', d(5, '04:00'), d(5, '12:00')),
  ]

  it('an exact, unique account name is an automatic match', () => {
    const r = status(classifyScheduleNames(people, profiles, []), 'אורי כהן')!
    expect(r.status).toBe('exact')
    expect(r.userId).toBe('a')
    expect(r.shifts).toBe(2)
  })

  it('two accounts with the same name are ambiguous, never linked to one', () => {
    const r = status(classifyScheduleNames(people, profiles, []), 'תמר גל')!
    expect(r.status).toBe('ambiguous')
    expect(r.reason).toBe('duplicate_accounts')
    expect(r.userId).toBeNull()
  })

  it('the same name on two rows at the same time is ambiguous (two people)', () => {
    const twice = [row('אורי כהן', d(5, '04:00'), d(5, '12:00')), row('אורי כהן', d(5, '05:00'), d(5, '13:00'))]
    const r = status(classifyScheduleNames(twice, profiles, []), 'אורי כהן')!
    expect(r.status).toBe('ambiguous')
    expect(r.reason).toBe('overlapping_rows')
  })

  it('even a short overlap is only a sign to review, so the name is flagged (no tolerance approved)', () => {
    const handover = [row('אורי כהן', d(5, '04:00'), d(5, '12:10')), row('אורי כהן', d(5, '11:45'), d(5, '20:10'))]
    const r = status(classifyScheduleNames(handover, profiles, []), 'אורי כהן')!
    expect(r.status).toBe('ambiguous')
    expect(r.userId).toBeNull()
  })

  it('rows that only touch (one ends when the next starts) are not an overlap', () => {
    const touching = [row('אורי כהן', d(5, '04:00'), d(5, '12:00')), row('אורי כהן', d(5, '12:00'), d(5, '20:00'))]
    expect(status(classifyScheduleNames(touching, profiles, []), 'אורי כהן')!.status).toBe('exact')
  })

  it('a similar-but-not-equal name is only a suggestion, and not linked', () => {
    const r = status(classifyScheduleNames(people, profiles, []), 'גיא מהצרי')!
    expect(r.status).toBe('unlinked')
    expect(r.userId).toBeNull()
    expect(r.suggestedUserId).toBe('g')
  })

  it('a name with nothing similar is unlinked with no suggestion', () => {
    const r = status(classifyScheduleNames(people, profiles, []), 'שם חדש')!
    expect(r).toMatchObject({ status: 'unlinked', suggestedUserId: null })
  })

  it('an explicit link wins over a conflicting automatic match', () => {
    const links = [{ source_key: personNameKey('אורי כהן'), user_id: 'd1', is_ambiguous: false }]
    const r = status(classifyScheduleNames(people, profiles, links), 'אורי כהן')!
    expect(r).toMatchObject({ status: 'explicit', userId: 'd1' })
  })

  it('a "do not attribute" decision resolves an ambiguity', () => {
    const links = [{ source_key: personNameKey('תמר גל'), user_id: null, is_ambiguous: true }]
    expect(status(classifyScheduleNames(people, profiles, links), 'תמר גל')!.status).toBe('marked_ambiguous')
  })

  it('lists names that need a decision first', () => {
    const rows = classifyScheduleNames(people, profiles, [])
    expect(rows[0].status).toBe('ambiguous')
    expect(rows[rows.length - 1].status).toBe('exact')
  })
})
