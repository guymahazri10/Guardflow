import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
let storageUpload: (...args: unknown[]) => unknown = vi.fn()
const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
let fromImpl: () => unknown = () => ({ update: (...args: unknown[]) => update(...args) })
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    storage: { from: () => ({ upload: (...args: unknown[]) => storageUpload(...args) }) },
    from: () => fromImpl(),
  },
}))

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

describe('identical re-upload', () => {
  it('does not upload again when the resumed import already has its file stored', async () => {
    const { storeImportFiles } = await import('./scheduleImports')
    const upload = vi.fn()
    storageUpload = upload
    const result = await storeImportFiles({ id: 'imp', storage_path: '2026-10-18/imp/f.xls' }, [new File(['x'], 'f.xls')], '2026-10-18')
    expect(result).toEqual({ storagePath: '2026-10-18/imp/f.xls', uploaded: false })
    expect(upload).not.toHaveBeenCalled()
  })

  it('uploads once, to the import id path, and records the path for a new import', async () => {
    const { storeImportFiles } = await import('./scheduleImports')
    const upload = vi.fn().mockResolvedValue({ error: null })
    storageUpload = upload
    const result = await storeImportFiles({ id: 'imp2', storage_path: '' }, [new File(['x'], 'סידור.xls')], '2026-10-18')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toMatch(/^2026-10-18\/imp2\/.+\.xls$/)
    expect(upload.mock.calls[0][2]).toEqual({ upsert: true })
    expect(result.uploaded).toBe(true)
  })

  it('ends with a visible error instead of hanging when the storage request never answers', async () => {
    vi.useFakeTimers()
    const { storeImportFiles, UPLOAD_TIMEOUT_MS } = await import('./scheduleImports')
    storageUpload = vi.fn().mockReturnValue(new Promise(() => {}))
    const pending = storeImportFiles({ id: 'imp3', storage_path: '' }, [new File(['x'], 'f.xls')], '2026-10-18')
    const assertion = expect(pending).rejects.toThrow('לא הסתיימה בזמן')
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS + 1)
    await assertion
    vi.useRealTimers()
  })
})

describe('createScheduleImport on an identical upload', () => {
  it('resumes the existing row (same week + hash) instead of creating a second one', async () => {
    const { createScheduleImport } = await import('./scheduleImports')
    const existing = { id: 'existing', storage_path: '2026-10-18/existing/f.xls', status: 'published' }
    fromImpl = () => ({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }) }) }),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) }) }) }),
    })
    const row = await createScheduleImport({
      week_start: '2026-10-18', source_kind: 'excel', storage_path: '', original_filename: 'f.xls', content_hash: 'h', created_by: 'u',
    })
    expect(row).toBe(existing)
    fromImpl = () => ({ update: (...args: unknown[]) => update(...args) })
  })
})
