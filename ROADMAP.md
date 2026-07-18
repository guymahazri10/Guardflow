# ROADMAP — GuardFlow (Phases)

> נספח ל־[SPEC.md](SPEC.md). מטרתו לתעד תמיד "איפה אנחנו נמצאים" לאורך הבנייה.
> **החלטת ארכיטקטורה:** `roster_boards` הוא מקור האמת היחיד — גם למבנה וגם לשמות (`guard_names`). `shift_staffing` מוזנחת ותימחק ב־Phase 7.

**סטטוס נוכחי: כל השלבים (0–7) הושלמו.**

---

## Phase 0 — יישור תשתית ומקור אמת יחיד ✅ הושלם
**מטרה:** לחסל את הניתוק הארכיטקטוני *לפני* בניית פיצ'רים — טבלה אחת, עץ קוד אחד, טיפוס אחד, build ירוק.

**משימות:**
- Migration: הוספת `guard_names jsonb not null default '{}'` ל־`roster_boards`; סימון `shift_staffing` כ־deprecated.
- איחוד טיפוס `RosterBoard` לטיפוס יחיד ב־[rosterBoards.ts](src/lib/rosterBoards.ts) הכולל `guard_names`; מחיקת `types/index.ts`.
- מחיקת כפילויות חד־משמעיות: `App.tsx`, `context/AuthContext.tsx`, `components/layout/AppShell.tsx`, `pages/Login.tsx`, `pages/AdminPanel.tsx`, `tailwind.config.ts`, `lib/shiftTime.ts`.
- תיקון שגיאות build/typecheck קיימות (`vite-env.d.ts` חסר, narrowing bug ב־AuthContext, JSX namespace ב־BottomNav, unused var ב־ShiftLive).

**Definition of Done:** `npm run build` עובר נקי; `AuthContext` אחד, `RosterBoard` אחד; `roster_boards` כולל `guard_names` ב־Supabase; אין import לקבצים שנמחקו.
**תלויות:** אין.

---

## Phase 1 — שכבת נתונים לשמות + RLS לאחמ"ש ✅ הושלם
**מטרה:** קריאה/כתיבה של `guard_names` דרך שכבה אחת, עם הרשאה נכונה.
**משימות:** הרחבת `rosterBoards.ts`/`useRosterBoards.ts` לעדכון שמות; מנגנון RLS/RPC שמאפשר לאחמ"ש לעדכן שמות בלי לגעת במבנה.
**DoD:** אחמ"ש שומר שמות בהצלחה; מנהל שומר בהצלחה; מאבטח נחסם; מבנה נשאר מנהל־בלבד.
**תלויות:** Phase 0.

**מימוש:** פונקציית RPC מסוג `SECURITY DEFINER` — [phase5_guard_names_write_access.sql](supabase/phase5_guard_names_write_access.sql) — `public.update_roster_board_guard_names(board_id, new_guard_names)`, בודקת `get_my_role() in ('מנהל','אחמ"ש')` ומעדכנת אך ורק את `guard_names` (מדיניות ה־RLS הקיימת ל־`UPDATE` על השורה כולה נשארת מנהל־בלבד ולא נגעת). שכבת קוד: `updateRosterBoardGuardNames` ב־[rosterBoards.ts](src/lib/rosterBoards.ts) + `useUpdateGuardNames` ב־[useRosterBoards.ts](src/hooks/useRosterBoards.ts). כל שלושת תרחישי ה־DoD אומתו חי מול ה־DB (RPC בהתחזות ל־session אמיתי דרך `request.jwt.claim.sub`), כולל בדיקה שהמבנה (`cols`) לא זז.

## Phase 2 — מסך Setup פונקציונלי ✅ הושלם
**מטרה:** מסך הזנת שמות אמיתי על הראוט המחובר.
**משימות:** העברת לוגיקת `ShiftSetup.tsx` אל `ShiftSetupPage.tsx`; מחיקת הקובץ המת לאחר ההעברה.
**DoD:** `/shift-setup` פונקציונלי; שמות נשמרים ב־`roster_boards`. מאומת חי.
**תלויות:** Phase 1.

**מימוש:** לוגיקת [ShiftSetup.tsx](src/pages/ShiftSetup.tsx) הועברה ל־[ShiftSetupPage.tsx](src/pages/ShiftSetupPage.tsx) (הקובץ המת נמחק) וכתיבת השמות עברה מ־`supabase.from(...).update(...)` ישיר ל־`useUpdateGuardNames` (ה־RPC של Phase 1), כדי שאחמ"ש לא ייחסם ב־RLS. תוך כדי כך התגלה ותוקן פער: `main.tsx` טען גיליון סגנון גנרי ([styles.css](src/styles.css), שנמחק) במקום מערכת העיצוב המלאה שכבר הייתה קיימת ב־[index.css](src/index.css) (RTL, `.card`, `.btn-primary`, `.safe-bottom` וכו') — בלעדיו כל המסכים המחוברים היו נראים שבורים. נוסף גם `<Toaster />` ל־`main.tsx`, שחסר לגמרי (קריאות `toast()` היו no-op בלי רכיב שמרנדר אותן).

## Phase 3 — מסך Live View פונקציונלי ✅ הושלם
**מטרה:** תצוגה חיה אמיתית, מונעת שעון, realtime.
**משימות:** העברת `ShiftLive.tsx`+hooks אל `ShiftLivePage.tsx`; מנוי Realtime על `roster_boards`.
**DoD:** `/shift-live` מציג בלוק נוכחי עם שמות; עדכון ב־Setup משתקף חי. מאומת חי.
**תלויות:** Phase 1, Phase 2.

**מימוש:** לוגיקת [ShiftLive.tsx](src/pages/ShiftLive.tsx) הועברה כלשונה ל־[ShiftLivePage.tsx](src/pages/ShiftLivePage.tsx) (הקובץ המת נמחק). מנוי ה־Realtime על `postgres_changes` ב־[useActiveBoard.ts](src/hooks/useActiveBoard.ts) היה כבר בנוי ותקין מקודם — לא נדרש שינוי שם. חישוב הבלוק הנוכחי הוצא לפונקציה משותפת ב־[shiftBlocks.ts](src/lib/shiftBlocks.ts) (בשימוש גם ב־Phase 6).

## Phase 4 — ניווט וקונכיית האפליקציה ✅ הושלם
**מטרה:** ניווט תחתון פעיל, מסונן לפי תפקיד (מבוסס BottomNav.tsx).
**DoD:** טאבים מנווטים ומסוננים נכון.
**תלויות:** Phase 0.

**מימוש:** [components/AppShell.tsx](src/components/AppShell.tsx) (הגרסה המחוברת בראוטר) הכיל טאבים סטטיים לא לחיצים; הוחלף ברכיב האמיתי [BottomNav.tsx](src/components/layout/BottomNav.tsx) שכבר תמך בניווט וסינון `adminOnly` לפי `isAdmin`. נוסף גם טאב "משתמשים" (`/users`), שקודם לא היה נגיש משום מקום בממשק.

## Phase 5 — פרופיל וניהול משתמשים ✅ הושלם
**מטרה:** מסכי פרופיל וניהול משתמשים פונקציונליים + RLS תואם (מבוסס Profile.tsx).
**DoD:** מנהל רואה/משנה תפקידים; RLS אוכף. מאומת חי.
**תלויות:** Phase 0/1.

**מימוש:** [Profile.tsx](src/pages/Profile.tsx) הועבר ל־[ProfilePage.tsx](src/pages/ProfilePage.tsx) (הקובץ המת נמחק). [UserManagementPage.tsx](src/pages/UserManagementPage.tsx) נבנה מאפס: טבלת משתמשים + `<select>` תפקיד לכל שורה (חסום לשורת המשתמש עצמו, כדי שמנהל לא ינעל את עצמו בטעות). שכבת קוד חדשה: [profiles.ts](src/lib/profiles.ts) + [useProfiles.ts](src/hooks/useProfiles.ts). RLS: מדיניות SELECT הורחבה כך שמנהל רואה את כולם ([phase6](supabase/phase6_user_management_rls.sql)), ושינוי תפקיד עצמו מתבצע רק דרך RPC `set_user_app_role` מנהל־בלבד — אומת חי (מנהל מצליח, מאבטח נחסם ב־`42501`).

## Phase 6 — התראות שינוי עמדה ✅ הושלם
**מטרה:** מאבטח מקבל התראה 5 דקות לפני שינוי עמדה (PositionChangeNotifier).
**DoD:** התראה אחת מדויקת בבדיקה, לא כשאין שינוי.
**תלויות:** Phase 3.

**מימוש:** `guard_names` הורחב מ־`Record<role,string>` ל־`Record<role,{name,user_id}>` (ראו [rosterBoards.ts](src/lib/rosterBoards.ts)) כדי לקשר תפקיד בלוח למשתמש אמיתי — נדרש כדי שההתראה תדע "מי אני" בלוח. נבנה `GuardNameInput` (בתוך [ShiftSetupPage.tsx](src/pages/ShiftSetupPage.tsx)): שדה שם חופשי + `<select>` לקישור אופציונלי למשתמש רשום מתוך `profiles`. הרחבת ה־RLS: מדיניות ה־SELECT על `profiles` נפתחה גם לאחמ"ש ([phase7](supabase/phase7_profiles_visible_to_commander.sql)), כי גם הוא עורך את Setup וצריך לחפש משתמשים. נבנה [PositionChangeNotifier.tsx](src/components/PositionChangeNotifier.tsx) — רכיב רקע שמותקן ב־AppShell, מוצא את התפקיד המקושר ל־`user.id`, ומשווה `cells[role]` בין הבלוק הנוכחי לבלוק הבא; אם הם שונים והבלוק הבא מתחיל בעוד 0–5 דקות, נשלחת התראה אחת (toast + Browser Notification) עם מפתח ייחודי שמונע כפילות. הלוגיקה הליבתית (ללא React) נבדקה בנפרד בסקריפט Node עצמאי על 5 תרחישים (כולל גלישת חצות למשמרת לילה) וגם אומתה מול ה־DB האמיתי (כתיבת `guard_names` עם `user_id` וקריאה חזרה).

## Phase 7 — הקשחה, מחיקת shift_staffing, וניקוי סופי ✅ הושלם
**מטרה:** לסגור RLS, למחוק את הטבלה המוזנחת, וליטוש.
**DoD:** `shift_staffing` נמחקה; מטריצת RLS מתועדת; אין קבצים מתים; build/lint/typecheck נקיים.
**תלויות:** כל השלבים הקודמים.

**מימוש:** `public.shift_staffing` נמחקה ב־[phase8_drop_shift_staffing.sql](supabase/phase8_drop_shift_staffing.sql) (0 שורות, אין קוד שמפנה אליה — אושר על ידי המשתמש לפני ההרצה, מכיוון שזו פעולה הרסנית). `npm run build` (`tsc -b && vite build`) נקי; אין קבצים כפולים בעץ `src`. אין ESLint מוגדר בפרויקט.

### מטריצת RLS סופית

| טבלה | קריאה (SELECT) | כתיבה |
|---|---|---|
| `roster_boards` | כל `authenticated` | מבנה (`cols/rows/shift_id/shift_type/notes/published`) — מנהל בלבד (`roster_boards update/insert/delete manager`). `guard_names` — מנהל **או** אחמ"ש, ורק דרך ה־RPC `update_roster_board_guard_names` ([phase5](supabase/phase5_guard_names_write_access.sql)); ה־RPC נועל את עצמו לעמודה זו בלבד ואינו נוגע במבנה. |
| `profiles` | השורה של עצמך, **או** כל השורות אם התפקיד מנהל/אחמ"ש ([phase7](supabase/phase7_profiles_visible_to_commander.sql)) | עדכון עצמי לשדות שאינם `app_role` (מדיניות Phase 2A, ללא שינוי). שינוי `app_role` — מנהל בלבד, ורק דרך ה־RPC `set_user_app_role` ([phase6](supabase/phase6_user_management_rls.sql)); לא ניתן לקדם את עצמך גם דרך ה־RPC הזה בפועל כי ה־UI חוסם עריכת תפקיד עצמי, אך ה־RPC עצמו היה מאפשר זאת אם תפקידך כבר מנהל. |
| `shift_staffing` | — (הטבלה נמחקה) | — |

כל שלוש נקודות ההרשאה (מבנה roster_boards, guard_names, app_role) אומתו חי מול ה־DB האמיתי בהתחזות ל־session אמיתי (`request.jwt.claim.sub`), כולל תרחישי חסימה (`42501`).

---

**מסלול קריטי:** Phase 0 → 1 → 2 → 3 הם עמוד השדרה. 4/5/6 עצמאיים יחסית. 7 תמיד אחרון.
