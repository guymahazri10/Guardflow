import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const ROLE_LABELS: Record<string, string> = {
  'מנהל': 'מנהל',
  'אחמ"ש': 'אחמ"ש',
  'מאבטח': 'מאבטח',
};

export default function Profile() {
  const { profile, user, appRole, signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    toast.success('יצאת מהמערכת');
  }

  return (
    <div className="flex-1 p-4 flex flex-col gap-4 max-w-mobile mx-auto w-full">
      {/* Profile card */}
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center text-primary font-bold text-lg shrink-0">
            {profile?.full_name?.[0] ?? user?.email?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary truncate">
              {profile?.full_name ?? 'ללא שם'}
            </p>
            <p className="text-text-secondary text-sm truncate" dir="ltr">
              {user?.email ?? ''}
            </p>
          </div>
        </div>

        {appRole && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary text-sm">תפקיד</span>
              <span className="font-medium text-sm bg-primary-light text-primary px-2.5 py-0.5 rounded-badge">
                {ROLE_LABELS[appRole] ?? appRole}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card divide-y divide-border">
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-5 py-4 text-right text-red-500 font-medium text-sm active:bg-red-50 transition-colors"
        >
          <span>יציאה מהמערכת</span>
        </button>
      </div>

      <p className="text-center text-text-muted text-xs mt-auto pb-2">
        GuardFlow v1.0
      </p>
    </div>
  );
}
