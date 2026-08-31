import { useState } from 'react'
import { useProfiles } from '../hooks/useProfiles'
import { callReplaceAssignmentWorker } from '../lib/scheduleImports'

const QUICK_REASONS = ['לא הגיע', 'מחלה', 'החלפה']

function getReadableError(error: unknown): string {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function AssignmentSwapModal({
  assignmentId,
  onClose,
  onSaved,
}: {
  assignmentId: string
  onClose: () => void
  onSaved: () => void
}) {
  const profilesQuery = useProfiles()
  const [selectedUserId, setSelectedUserId] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!selectedUserId) {
      setError('יש לבחור מאבטח מחליף.')
      return
    }
    if (!reason.trim()) {
      setError('יש להזין סיבה.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const profile = profilesQuery.data?.find((p) => p.id === selectedUserId)
      await callReplaceAssignmentWorker({
        assignmentId,
        newUserId: selectedUserId,
        newName: profile?.full_name ?? '',
        reason: reason.trim(),
      })
      onSaved()
    } catch (err) {
      setError(getReadableError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div dir="rtl" role="dialog" className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded p-4 w-80">
        <h2 className="font-bold mb-2">החלפת מאבטח</h2>

        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="w-full mb-2 border rounded p-1"
        >
          <option value="" disabled>
            בחר מאבטח מחליף
          </option>
          {(profilesQuery.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>

        <div className="flex gap-1 mb-2 flex-wrap">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className="border rounded px-2 py-1 text-sm"
            >
              {r}
            </button>
          ))}
        </div>

        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="סיבה"
          className="w-full mb-2 border rounded p-1"
        />

        {error && (
          <div className="text-red-800 mb-2" role="alert">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'שומר…' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  )
}
