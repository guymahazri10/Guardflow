import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useAuth, type AppRole } from '../contexts/AuthContext'
import { useDeleteUser, useInviteUser, useProfiles, useSetUserAppRole, useSetUserFullName } from '../hooks/useProfiles'
import type { ProfileListItem } from '../lib/profiles'
import { APP_ROLES, countByRole, filterProfiles, normalizeRole, type RoleFilter } from '../lib/userFilters'
import UserFilters from '../components/users/UserFilters'
import UserRow from '../components/users/UserRow'
import { ROLE_COLORS, ROLE_DESCRIPTIONS, displayNameOf } from '../components/users/userRoles'

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function UserManagementPage() {
  const { user } = useAuth()
  const profilesQuery = useProfiles()
  const setUserAppRoleMutation = useSetUserAppRole()
  const setUserFullNameMutation = useSetUserFullName()
  const inviteUserMutation = useInviteUser()
  const deleteUserMutation = useDeleteUser()
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false)
  const [deleteSheetFor, setDeleteSheetFor] = useState<ProfileListItem | null>(null)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')

  const profiles = profilesQuery.data ?? []
  const visibleProfiles = filterProfiles(profiles, query, roleFilter)
  const counts = countByRole(profiles)

  function clearFilters() {
    setQuery('')
    setRoleFilter('all')
  }

  async function changeRole(profile: ProfileListItem, newRole: AppRole) {
    setPendingUserId(profile.id)
    try {
      await setUserAppRoleMutation.mutateAsync({ userId: profile.id, newRole })
    } finally {
      setPendingUserId(null)
    }
  }

  async function handleRoleChange(profile: ProfileListItem, newRole: AppRole) {
    const previousRole = normalizeRole(profile.app_role)
    setActionError(null)

    try {
      await changeRole(profile, newRole)
    } catch (error) {
      setActionError(getReadableError(error))
      return
    }

    toast(
      (t) => (
        <span className="flex items-center gap-3 text-sm">
          <span>
            {displayNameOf(profile)}: התפקיד שונה ל{newRole}
          </span>
          <button
            type="button"
            className="font-bold text-primary-600 min-h-11 px-2"
            onClick={() => {
              toast.dismiss(t.id)
              changeRole(profile, previousRole).catch((error) => toast.error(getReadableError(error)))
            }}
          >
            ביטול
          </button>
        </span>
      ),
      { duration: 5000 },
    )
  }

  async function handleNameChange(userId: string, newFullName: string) {
    setActionError(null)
    setPendingUserId(userId)

    try {
      await setUserFullNameMutation.mutateAsync({ userId, newFullName })
    } catch (error) {
      setActionError(getReadableError(error))
    } finally {
      setPendingUserId(null)
    }
  }

  async function handleInvite(email: string, fullName: string, role: AppRole) {
    setActionError(null)

    try {
      await inviteUserMutation.mutateAsync({ email, fullName, role })
      setInviteSheetOpen(false)
      toast.success('ההזמנה נשלחה בהצלחה')
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  async function handleDelete(userId: string) {
    setActionError(null)
    setPendingUserId(userId)

    try {
      await deleteUserMutation.mutateAsync(userId)
      setDeleteSheetFor(null)
      toast.success('המשתמש נמחק')
    } catch (error) {
      setActionError(getReadableError(error))
    } finally {
      setPendingUserId(null)
    }
  }

  return (
    <div className="flex flex-col flex-1 max-w-mobile lg:max-w-5xl mx-auto w-full">
      {/* ── Header ── */}
      <div className="page-header flex items-center justify-between gap-3">
        <h1 className="text-lg">
          <span className="font-light text-text-secondary">ניהול</span> <b className="font-extrabold">משתמשים</b>
        </h1>
        <button onClick={() => setInviteSheetOpen(true)} className="btn-primary shrink-0 whitespace-nowrap !px-4 !py-2.5 text-[13px]">
          + הזמן
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
        {!profilesQuery.isLoading && profiles.length > 0 && (
          <UserFilters
            query={query}
            onQueryChange={setQuery}
            role={roleFilter}
            onRoleChange={setRoleFilter}
            counts={counts}
            shown={visibleProfiles.length}
          />
        )}

        {actionError && (
          <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">{actionError}</div>
        )}

        {profilesQuery.isError && (
          <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
            טעינת המשתמשים נכשלה. נסה לרענן את העמוד.
          </div>
        )}

        {/* ── Users list ── */}
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:content-start">
          {profilesQuery.isLoading ? (
            <ListSkeleton />
          ) : profiles.length === 0 ? (
            <div className="card p-6 text-center text-sm text-text-secondary lg:col-span-2">לא נמצאו משתמשים.</div>
          ) : visibleProfiles.length === 0 ? (
            <div className="card p-6 text-center lg:col-span-2">
              <p className="text-sm text-text-secondary">לא נמצאו משתמשים שמתאימים לחיפוש.</p>
              <button type="button" onClick={clearFilters} className="btn-ghost mt-3 min-h-11">
                נקה סינון
              </button>
            </div>
          ) : (
            visibleProfiles.map((profile) => (
              <UserRow
                key={profile.id}
                profile={profile}
                isSelf={profile.id === user?.id}
                pending={pendingUserId === profile.id}
                onChangeRole={(role) => {
                  void handleRoleChange(profile, role)
                }}
                onSaveName={(name) => {
                  void handleNameChange(profile.id, name)
                }}
                onDelete={() => setDeleteSheetFor(profile)}
              />
            ))
          )}
        </div>
      </div>

      {inviteSheetOpen && (
        <InviteSheet
          saving={inviteUserMutation.isPending}
          onInvite={(email, fullName, role) => {
            void handleInvite(email, fullName, role)
          }}
          onClose={() => setInviteSheetOpen(false)}
        />
      )}

      {deleteSheetFor && (
        <DeleteUserSheet
          profile={deleteSheetFor}
          deleting={deleteUserMutation.isPending}
          onConfirm={() => {
            void handleDelete(deleteSheetFor.id)
          }}
          onClose={() => setDeleteSheetFor(null)}
        />
      )}
    </div>
  )
}

/* ─── Invite user bottom sheet ───────────────────────────────── */

function InviteSheet({
  saving,
  onInvite,
  onClose,
}: {
  saving: boolean
  onInvite: (email: string, fullName: string, role: AppRole) => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<AppRole>('מאבטח')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onInvite(email.trim(), fullName.trim(), role)
  }

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/45 z-[100] flex items-end">
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-mobile mx-auto bg-white rounded-t-[20px] safe-bottom p-4"
      >
        <div className="w-9 h-1 rounded-full bg-border mx-auto mb-4" />
        <p className="text-sm font-bold text-text-primary mb-3 text-right">הזמנת משתמש חדש</p>

        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="אימייל"
          autoFocus
          required
          dir="ltr"
          className="input-field w-full mb-3"
        />

        <input
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="שם מלא (אופציונלי)"
          dir="rtl"
          className="input-field w-full mb-3"
        />

        <p className="text-xs font-bold text-text-muted mb-2 text-right">תפקיד</p>
        <div className="flex flex-col gap-2 mb-4">
          {APP_ROLES.map((r) => {
            const c = ROLE_COLORS[r]
            const active = r === role

            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-right min-h-[48px] ${
                  active ? '' : 'bg-background border-border'
                }`}
                style={active ? { backgroundColor: c.bg, borderColor: c.border } : undefined}
              >
                <span
                  className="rounded-badge px-2.5 py-1 text-xs font-bold shrink-0"
                  style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
                >
                  {r}
                </span>
                <span className="text-xs text-text-secondary flex-1">{ROLE_DESCRIPTIONS[r]}</span>
                {active && <span style={{ color: c.color }}>✓</span>}
              </button>
            )
          })}
        </div>

        <button
          type="submit"
          disabled={saving || !email.trim()}
          className="btn-primary w-full h-12 rounded-xl disabled:opacity-50"
        >
          {saving ? 'שולח הזמנה...' : 'שלח הזמנה'}
        </button>
      </form>
    </div>
  )
}

/* ─── Delete user confirmation sheet ─────────────────────────── */

function DeleteUserSheet({
  profile,
  deleting,
  onConfirm,
  onClose,
}: {
  profile: ProfileListItem
  deleting: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/45 z-[100] flex items-end">
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-mobile mx-auto bg-white rounded-t-[20px] safe-bottom p-4">
        <div className="w-9 h-1 rounded-full bg-border mx-auto mb-4" />
        <p className="text-sm font-bold text-text-primary mb-2 text-right">מחיקת {displayNameOf(profile)}</p>
        <p className="text-xs text-text-secondary mb-4 text-right">
          הפעולה תמחק לצמיתות את המשתמש ואת הגישה שלו למערכת. לא ניתן לשחזר.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 h-12 rounded-xl border border-border bg-background text-text-secondary font-semibold text-sm disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 h-12 rounded-xl bg-danger text-white font-semibold text-sm disabled:opacity-50"
          >
            {deleting ? 'מוחק...' : 'מחק משתמש'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Skeleton ────────────────────────────────────────────────── */

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card flex items-center gap-2.5 px-3.5 py-3 min-h-[72px] animate-pulse">
          <div className="w-11 h-11 rounded-full bg-border shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3.5 w-24 bg-border rounded" />
            <div className="h-3 w-32 bg-border rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
