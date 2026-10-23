// Pure (no Supabase client) so tests and pure modules can use it without environment variables.

/** What went wrong with a manager edit, in terms the screen can explain. */
export type ScheduleEditErrorKind =
  | 'concurrent' // someone changed the row after the manager loaded it
  | 'occupied' // the target place already holds a live shift
  | 'reason_required' // a past shift needs a reason
  | 'cancelled' // the row is cancelled (restore it first)
  | 'not_cancelled'
  | 'moved_away' // the cancelled marker was left by a move whose copy is still live
  | 'no_changes'
  | 'denied'
  | 'invalid'
  | 'other'

export class ScheduleEditError extends Error {
  kind: ScheduleEditErrorKind
  constructor(kind: ScheduleEditErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

const MESSAGES: Record<ScheduleEditErrorKind, string> = {
  concurrent: 'השיבוץ שונה בינתיים על ידי משתמש אחר. הנתונים רועננו — יש לבדוק ולנסות שוב.',
  occupied: 'מקום היעד תפוס בשיבוץ אחר. לא בוצע שינוי. אפשר לבטל או להעביר קודם את השיבוץ שנמצא שם.',
  reason_required: 'לתיקון משמרת שכבר עברה יש להזין סיבה.',
  cancelled: 'השיבוץ מבוטל. יש לשחזר אותו לפני עריכה.',
  not_cancelled: 'השיבוץ אינו מבוטל.',
  moved_away: 'השיבוץ הזה הועבר למקום אחר ועדיין פעיל שם. אפשר לבטל או להעביר את העותק החדש.',
  no_changes: 'לא בוצע שינוי.',
  denied: 'רק מנהל רשאי לערוך את הסידור.',
  invalid: 'הנתונים אינם תקינים. יש לבדוק שעות, עמדה ועובד.',
  other: 'הפעולה נכשלה. נסה שוב.',
}

export function mapEditError(error: { message?: string; code?: string }): ScheduleEditError {
  const m = error.message ?? ''
  const code = error.code ?? ''
  const kind: ScheduleEditErrorKind =
    code === '42501' || m.includes('Only מנהל')
      ? 'denied'
      : m.includes('concurrent_change') || code === '40001'
        ? 'concurrent'
        : m.includes('target_occupied') || code === '23505'
          ? 'occupied'
          : m.includes('reason_required')
            ? 'reason_required'
            : m.includes('assignment_cancelled')
              ? 'cancelled'
              : m.includes('assignment_not_cancelled')
                ? 'not_cancelled'
                : m.includes('moved_away')
                  ? 'moved_away'
                  : m.includes('no_changes')
                    ? 'no_changes'
                    : code === '22023'
                      ? 'invalid'
                      : 'other'
  return new ScheduleEditError(kind, MESSAGES[kind])
}
