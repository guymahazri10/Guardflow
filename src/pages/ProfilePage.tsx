import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

const ROLE_LABELS: Record<string, string> = {
  'מנהל': 'מנהל',
  'אחמ"ש': 'אחמ"ש',
  'מאבטח': 'מאבטח',
}

// Visual weight mirrors permission level: מנהל gets the gold "top tier" mark,
// אחמ"ש a functional blue tint, מאבטח stays quiet/neutral.
const ROLE_CHIP_CLASS: Record<string, string> = {
  'מנהל': 'bg-gold text-text-primary',
  'אחמ"ש': 'bg-primary-light text-primary',
  'מאבטח': 'bg-background-2 text-text-secondary',
}

export function ProfilePage() {
  const { profile, user, appRole, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    toast.success('יצאת מהמערכת')
  }

  return (
    <div className="flex-1 p-4 flex flex-col gap-4 max-w-mobile mx-auto w-full">
      <div className="text-center pt-2 pb-1">
        <h1 className="text-xl">
          <span className="font-light text-text-secondary">הפרופיל</span> <b className="font-extrabold">שלי</b>
        </h1>
      </div>

      {/* Profile card */}
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-extrabold text-lg shrink-0">
            {profile?.full_name?.[0] ?? user?.email?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary truncate">{profile?.full_name ?? 'ללא שם'}</p>
            <p className="text-text-secondary text-sm truncate" dir="ltr">
              {user?.email ?? ''}
            </p>
          </div>
        </div>

        {appRole && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary text-sm">תפקיד</span>
              <span className={`font-bold text-sm px-2.5 py-0.5 rounded-badge ${ROLE_CHIP_CLASS[appRole] ?? 'bg-primary-light text-text-secondary'}`}>
                {ROLE_LABELS[appRole] ?? appRole}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card divide-y divide-border">
        <button
          onClick={() => {
            void handleSignOut()
          }}
          className="w-full flex items-center gap-3 px-5 py-4 text-right text-danger font-semibold text-sm active:bg-danger-light transition-colors"
        >
          <span>יציאה מהמערכת</span>
        </button>
      </div>

      <p className="text-center text-text-muted text-xs mt-auto pb-2">GuardFlow v1.0</p>
    </div>
  )
}
