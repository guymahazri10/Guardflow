import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useAuth, type AppRole } from '../contexts/AuthContext'
import { useDeleteUser, useInviteUser, useProfiles, useSetUserAppRole, useSetUserFullName } from '../hooks/useProfiles'
import type { ProfileListItem } from '../lib/profiles'

const APP_ROLES: AppRole[] = ['מנהל', 'אחמ"ש', 'מאבטח']

const ROLE_COLORS: Record<AppRole, { bg: string; color: string; border: string }> = {
  מנהל: { bg: '#D4A24A', color: '#15171A', border: 'transparent' },
  'אחמ"ש': { bg: '#E8EFF8', color: '#1B56A5', border: 'transparent' },
  מאבטח: { bg: '#F1F3F5', color: '#6F7782', border: 'transparent' },
}

const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  מנהל: 'גישה מלאה — ניהול לו״זים, משתמשים, עריכה',
  'אחמ"ש': 'מילוי שמות + צפייה בלו״ז — ללא ניהול',
  מאבטח: 'צפייה בלו״ז בלבד (ברירת מחדל לכל משתמש)',
}

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

function displayNameOf(profile: ProfileListItem): string {
  return profile.full_name ?? profile.email ?? '—'
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
  const [roleSheetFor, setRoleSheetFor] = useState<ProfileListItem | null>(null)
  const [nameSheetFor, setNameSheetFor] = useState<ProfileListItem | null>(null)
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false)
  const [deleteSheetFor, setDeleteSheetFor] = useState<ProfileListItem | null>(null)

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

  async function handleNameChange(userId: string, newFullName: string) {
    setActionError(null)
    setPendingUserId(userId)

    try {
      await setUserFullNameMutation.mutateAsync({ userId, newFullName })
      setNameSheetFor(null)
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
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      {/* ── Header ── */}
      <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between gap-3">
        <h1 className="text-lg">
          <span className="font-light text-text-secondary">ניהול</span> <b className="font-extrabold">משתמשים</b>
        </h1>
        <button onClick={() => setInviteSheetOpen(true)} className="btn-primary shrink-0 whitespace-nowrap !px-4 !py-2.5 text-[13px]">
          + הזמן
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
        {/* ── Role legend ── */}
        <div className="card p-4">
          <p className="text-xs font-bold text-text-muted mb-2.5">הרשאות לפי תפקיד</p>
          <div className="flex flex-col gap-2">
            {APP_ROLES.map((role) => {
              const c = ROLE_COLORS[role]
              return (
                <div key={role} className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-bold rounded-badge px-2 py-0.5 shrink-0"
                    style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
                  >
                    {role}
                  </span>
                  <span className="text-xs text-text-secondary">{ROLE_DESCRIPTIONS[role]}</span>
                </div>
              )
            })}
          </div>
        </div>

        {actionError && (
          <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">{actionError}</div>
        )}

        {profilesQuery.isError && (
          <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
            טעינת המשתמשים נכשלה. נסה לרענן את העמוד.
          </div>
        )}

        {/* ── Users list ── */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold text-text-muted">משתמשים רשומים ({profiles.length})</p>

          {profilesQuery.isLoading ? (
            <ListSkeleton />
          ) : profiles.length === 0 ? (
            <div className="card p-6 text-center text-sm text-text-secondary">לא נמצאו משתמשים.</div>
          ) : (
            profiles.map((profile) => (
              <UserRow
                key={profile.id}
                profile={profile}
                isSelf={profile.id === user?.id}
                pending={pendingUserId === profile.id}
                onOpenRoleSheet={() => setRoleSheetFor(profile)}
                onOpenNameSheet={() => setNameSheetFor(profile)}
                onOpenDeleteSheet={() => setDeleteSheetFor(profile)}
              />
            ))
          )}
        </div>
      </div>

      {roleSheetFor && (
        <RoleSheet
          profile={roleSheetFor}
          onSelect={(role) => {
            void handleRoleChange(roleSheetFor.id, role)
          }}
          onClose={() => setRoleSheetFor(null)}
        />
      )}

      {nameSheetFor && (
        <EditNameSheet
          profile={nameSheetFor}
          saving={setUserFullNameMutation.isPending}
          onSave={(name) => {
            void handleNameChange(nameSheetFor.id, name)
          }}
          onClose={() => setNameSheetFor(null)}
        />
      )}

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

/* ─── User row ────────────────────────────────────────────────── */

function UserRow({
  profile,
  isSelf,
  pending,
  onOpenRoleSheet,
  onOpenNameSheet,
  onOpenDeleteSheet,
}: {
  profile: ProfileListItem
  isSelf: boolean
  pending: boolean
  onOpenRoleSheet: () => void
  onOpenNameSheet: () => void
  onOpenDeleteSheet: () => void
}) {
  const role = (APP_ROLES.includes(profile.app_role as AppRole) ? profile.app_role : 'מאבטח') as AppRole
  const c = ROLE_COLORS[role]
  const name = displayNameOf(profile)

  return (
    <div className="card flex items-center gap-2.5 px-3.5 py-3 min-h-[72px]">
      <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0">
        <span className="text-white font-extrabold text-base">{name[0]?.toUpperCase() ?? '?'}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-text-primary truncate">{name}</p>
        <p className="text-[11px] text-text-muted truncate" dir="ltr">
          {profile.email ?? '—'}
        </p>
      </div>

      <button
        onClick={onOpenNameSheet}
        disabled={pending}
        aria-label="ערוך שם"
        className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0 text-text-secondary disabled:opacity-50"
      >
        ✏️
      </button>

      {isSelf ? (
        <span
          className="text-[11px] font-bold rounded-badge px-2.5 py-1.5 shrink-0"
          style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
          title="לא ניתן לשנות תפקיד לעצמך"
        >
          {role} (אתה)
        </span>
      ) : (
        <button
          onClick={onOpenRoleSheet}
          disabled={pending}
          className="flex items-center gap-1 text-[11px] font-bold rounded-badge px-2.5 py-1.5 shrink-0 disabled:opacity-50"
          style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
        >
          {role} ⌄
        </button>
      )}

      {!isSelf && (
        <button
          onClick={onOpenDeleteSheet}
          disabled={pending}
          aria-label="מחק משתמש"
          className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0 text-danger disabled:opacity-50"
        >
          🗑️
        </button>
      )}
    </div>
  )
}

/* ─── Role picker bottom sheet ────────────────────────────────── */

function RoleSheet({
  profile,
  onSelect,
  onClose,
}: {
  profile: ProfileListItem
  onSelect: (role: AppRole) => void
  onClose: () => void
}) {
  const currentRole = (APP_ROLES.includes(profile.app_role as AppRole) ? profile.app_role : 'מאבטח') as AppRole

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/45 z-[100] flex items-end">
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-mobile mx-auto bg-white rounded-t-[20px] safe-bottom p-4">
        <div className="w-9 h-1 rounded-full bg-border mx-auto mb-4" />
        <p className="text-xs font-bold text-text-muted mb-3 text-right">שנה תפקיד: {displayNameOf(profile)}</p>

        {APP_ROLES.map((role) => {
          const c = ROLE_COLORS[role]
          const active = role === currentRole

          return (
            <button
              key={role}
              onClick={() => {
                onSelect(role)
                onClose()
              }}
              className={`w-full flex items-center gap-3 px-4 py-3.5 mb-2 rounded-xl border text-right min-h-[52px] last:mb-0 ${
                active ? '' : 'bg-background border-border'
              }`}
              style={active ? { backgroundColor: c.bg, borderColor: c.border } : undefined}
            >
              <span
                className="rounded-badge px-2.5 py-1 text-xs font-bold shrink-0"
                style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
              >
                {role}
              </span>
              <span className="text-xs text-text-secondary flex-1">{ROLE_DESCRIPTIONS[role]}</span>
              {active && <span style={{ color: c.color }}>✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Edit name bottom sheet ──────────────────────────────────── */

function EditNameSheet({
  profile,
  saving,
  onSave,
  onClose,
}: {
  profile: ProfileListItem
  saving: boolean
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(profile.full_name ?? '')

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/45 z-[100] flex items-end">
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-mobile mx-auto bg-white rounded-t-[20px] safe-bottom p-4">
        <div className="w-9 h-1 rounded-full bg-border mx-auto mb-4" />
        <p className="text-sm font-bold text-text-primary mb-3 text-right">עריכת שם תצוגה</p>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="שם מלא..."
          autoFocus
          dir="rtl"
          className="input-field w-full mb-3"
        />
        <button
          onClick={() => onSave(name.trim())}
          disabled={saving || !name.trim()}
          className="btn-primary w-full h-12 rounded-xl disabled:opacity-50"
        >
          {saving ? 'שומר...' : 'שמור'}
        </button>
      </div>
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
