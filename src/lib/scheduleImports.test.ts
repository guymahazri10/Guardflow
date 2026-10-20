import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

import { callPublishScheduleImport, SCHEMA_OUT_OF_DATE_MESSAGE } from './scheduleImports'

const input = { importId: 'i', assignments: [], resolutions: {}, confirmedDeleteIds: [], dryRun: true }

describe('callPublishScheduleImport', () => {
  beforeEach(() => rpc.mockReset())

  it('sends the phase20k parameters', async () => {
    rpc.mockResolvedValue({ data: { to_insert: [] }, error: null })
    await callPublishScheduleImport(input)
    expect(rpc).toHaveBeenCalledWith('publish_schedule_import', {
      p_import_id: 'i',
      p_assignments: [],
      p_resolutions: {},
      p_confirmed_delete_ids: [],
      p_dry_run: true,
    })
  })

  it('explains clearly when the database does not have the new parameters yet', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.publish_schedule_import(p_assignments, p_confirmed_delete_ids, ...) in the schema cache' },
    })
    await expect(callPublishScheduleImport(input)).rejects.toThrow(SCHEMA_OUT_OF_DATE_MESSAGE)
  })

  it('keeps the original message for any other failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only מנהל can publish' } })
    await expect(callPublishScheduleImport(input)).rejects.toThrow('Only מנהל can publish')
  })
})
