import { useState } from 'react'
import { useAuth, type AppRole } from '../contexts/AuthContext'
import { useProfiles, useSetUserAppRole, useSetUserFullName } from '../hooks/useProfiles'
import type { ProfileListItem } from '../lib/profiles'

const APP_ROLES: AppRole[] = ['מנהל', 'אחמ"ש', 'מאבטח']

const ROLE_COLORS: Record<AppRole, { bg: string; color: string; border: string }> = {
  מנהל: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  'אחמ"ש': { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  מאבטח: { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' },
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [roleSheetFor, setRoleSheetFor] = useState<ProfileListItem | null>(null)
  const [nameSheetFor, setNameSheetFor] = useState<ProfileListItem | null>(null)

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

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      {/* ── Header ── */}
      <div className="bg-white border-b border-border px-4 pt-5 pb-4">
        <h1 className="text-xl font-bold text-text-primary">ניהול משתמשים והרשאות</h1>
        <p className="text-text-secondary text-sm mt-0.5">צפייה במשתמשים, עדכון תפקידים ושמות</p>
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
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
        )}

        {profilesQuery.isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
}: {
  profile: ProfileListItem
  isSelf: boolean
  pending: boolean
  onOpenRoleSheet: () => void
  onOpenNameSheet: () => void
}) {
  const role = (APP_ROLES.includes(profile.app_role as AppRole) ? profile.app_role : 'מאבטח') as AppRole
  const c = ROLE_COLORS[role]
  const name = displayNameOf(profile)

  return (
    <div className="card flex items-center gap-2.5 px-3.5 py-3 min-h-[72px]">
      <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center shrink-0">
        <span className="text-primary font-extrabold text-base">{name[0]?.toUpperCase() ?? '?'}</span>
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
