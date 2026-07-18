import { useState } from 'react'
import { useAuth, type AppRole } from '../contexts/AuthContext'
import { useProfiles, useSetUserAppRole } from '../hooks/useProfiles'

const APP_ROLES: AppRole[] = ['מנהל', 'אחמ"ש', 'מאבטח']

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function UserManagementPage() {
  const { user } = useAuth()
  const profilesQuery = useProfiles()
  const setUserAppRoleMutation = useSetUserAppRole()
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)

  const profiles = profilesQuery.data ?? []

  async function handleRoleChange(userId: string, newRole: AppRole) {
    setActionError(null)
    setPendingUserId(userId)

    try {
      await setUserAppRoleMutation.mutateAsync({ userId, newRole })
    } catch (error) {
      setActionError(getReadableError(error))
    } finally {
      setPendingUserId(null)
    }
  }

  return (
    <section dir="rtl" className="mx-auto w-full max-w-5xl px-4 py-6 text-right">
      <div className="mb-6 space-y-2">
        <h1 className="text-2xl font-bold text-slate-950">ניהול משתמשים</h1>
        <p className="text-sm text-slate-600">צפייה במשתמשים ועדכון תפקידים.</p>
      </div>

      {profilesQuery.isLoading ? <p className="text-slate-700">טוען משתמשים...</p> : null}

      {profilesQuery.isError ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          טעינת המשתמשים נכשלה. נסה לרענן את העמוד.
        </p>
      ) : null}

      {actionError ? (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>
      ) : null}

      {!profilesQuery.isLoading && !profilesQuery.isError && profiles.length === 0 ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-4 text-slate-600">לא נמצאו משתמשים.</p>
      ) : null}

      {profiles.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-right font-medium">שם</th>
                <th className="px-4 py-3 text-right font-medium">אימייל</th>
                <th className="px-4 py-3 text-right font-medium">תפקיד</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profiles.map((profile) => {
                const isSelf = profile.id === user?.id
                const isPending = pendingUserId === profile.id

                return (
                  <tr key={profile.id}>
                    <td className="px-4 py-3 text-slate-900">{profile.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600" dir="ltr">
                      {profile.email ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span
                          className="inline-block rounded bg-primary-light px-2.5 py-1 text-xs font-medium text-primary"
                          title="לא ניתן לשנות תפקיד לעצמך"
                        >
                          {profile.app_role} (אתה)
                        </span>
                      ) : (
                        <select
                          value={profile.app_role ?? ''}
                          onChange={(event) => {
                            void handleRoleChange(profile.id, event.target.value as AppRole)
                          }}
                          disabled={isPending}
                          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-900 disabled:bg-slate-100"
                        >
                          {APP_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
