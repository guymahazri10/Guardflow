# SPEC — GuardFlow (React + Vite + TS + Supabase)

> **הקשר:** מסמך זה נכתב מתוך ההסבר המלא של גרסת Base44 (הגמורה) + סריקה של הריפו הנוכחי.
> מטרתו לתאר את התנהגות היעד בסטאק החדש, ובמיוחד **למנוע שחזור של באג ה־Base44** (עריכה במקום אחד, קריאה ממקום אחר).
>
> **החלטת ארכיטקטורה (מקור אמת יחיד):** `roster_boards` הוא מקור האמת היחיד — גם למבנה **וגם לשמות** (`guard_names`), בדיוק כפי שהישות `RosterBoard` של Base44 עבדה. טבלת `shift_staffing` **נמחקה** (Phase 7, ר' 3.2). כל נתיבי הקוד (Setup, Live, Editor) מתיישרים לטבלה אחת — זו הדרך למנוע את הניתוק, לא פיצול לשתי טבלאות.
> **שתי השלכות שנגזרות מההחלטה:** (א) שמות נצמדים ללוח, לא לתאריך — אין שמות שונים לכל יום ללא שינוי עתידי. (ב) כתיבת שמות ל־`roster_boards` דורשת הרשאת RLS לאחמ"ש — ממומש דרך RPC ייעודי, ר' 3.1 (Phase 1).

---

## 1. סקירה כללית

GuardFlow היא אפליקציית ווב (mobile-first, RTL בעברית) לניהול משמרות של צוותי אבטחה בזמן אמת בקמפוס.
שלושה סוגי משתמשים, לפי `app_role` בטבלת `profiles`:

- **מנהל** (Manager) — יוצר/עורך/מפרסם לוחות משמרת, מנהל משתמשים.
- **אחמ"ש** (Commander) — מזין/מעדכן שמות מאבטחים למשמרת פעילה.
- **מאבטח** (Guard) — צפייה בלבד בלוח החי + התראה על שינוי עמדה.

זרימה מרכזית: המנהל בונה **תבנית לו"ז** (תפקידים × בלוקי זמן × עמדות) → אחמ"ש/מנהל מזין **שמות** למשמרת של היום → כל המשתמשים רואים **תצוגה חיה** שמתעדכנת בזמן אמת ומחושבת לפי שעון אמת → מאבטח מקבל התראה כשעמדתו עומדת להשתנות.

---

## 2. מיפוי מונחים (Base44 → קוד נוכחי)

| Base44 | מימוש בסטאק הנוכחי | סטטוס |
|---|---|---|
| `RosterBoard` (ישות שכללה גם `guard_names` + `guard_user_ids`) | `roster_boards` — טבלה אחת, גם מבנה וגם שמות (`guard_names jsonb`, ערך `{name, user_id}` לכל תפקיד). `shift_staffing` נמחקה (Phase 7). טיפוס: `RosterBoard` ב־[rosterBoards.ts](src/lib/rosterBoards.ts) | ✅ קיים |
| `ShiftConfig.js` (ברירות מחדל) | `SHIFTS`/קטגוריות ב־[shifts.ts](src/constants/shifts.ts) + 5 התבניות ב־[defaultRosterTemplates.ts](src/lib/defaultRosterTemplates.ts). `shiftTime.ts` הכפול נמחק ב־Phase 0 | ✅ קיים |
| `RosterDb.js` (CRUD) | [rosterBoards.ts](src/lib/rosterBoards.ts) (CRUD + `updateRosterBoardGuardNames`) + [useRosterBoards.ts](src/hooks/useRosterBoards.ts) (react-query) | ✅ קיים |
| `ShiftSetup.jsx` | [ShiftSetupPage.tsx](src/pages/ShiftSetupPage.tsx) — מחובר ופונקציונלי (Phase 2). הקובץ הישן `ShiftSetup.tsx` נמחק לאחר ההעברה | ✅ קיים |
| `ShiftLive.jsx` | [ShiftLivePage.tsx](src/pages/ShiftLivePage.tsx) — מחובר ופונקציונלי (Phase 3), Realtime על `roster_boards` דרך [useActiveBoard.ts](src/hooks/useActiveBoard.ts) + [useClock.ts](src/hooks/useClock.ts). הקובץ הישן `ShiftLive.tsx` נמחק | ✅ קיים |
| `RosterEditor.jsx` | [RosterEditorPage.tsx](src/pages/RosterEditorPage.tsx) (מחובר, אמיתי) + [rosterEditorUtils.ts](src/lib/rosterEditorUtils.ts) | ✅ קיים |
| `PositionChangeNotifier.jsx` | [PositionChangeNotifier.tsx](src/components/PositionChangeNotifier.tsx) — מותקן ב־AppShell, פעיל למאבטח בלבד (Phase 6) | ✅ קיים |
| `AuthContext.jsx` | [contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) — יחיד. הכפילות `context/AuthContext.tsx` נמחקה ב־Phase 0 | ✅ קיים |
| `Permissions.js` + `can()` | אין מודול ייעודי; בוליאנים `isAdmin/isCommander/isGuard` ב־AuthContext + שומרי ראוט | קיים חלקית (מספיק, לא מרוכז) |
| `ProtectedPage.jsx` | [ProtectedRoute.tsx](src/components/routes/ProtectedRoute.tsx) + [AdminRoute.tsx](src/components/routes/AdminRoute.tsx) | ✅ קיים |
| `UserManagement.jsx` | [UserManagementPage.tsx](src/pages/UserManagementPage.tsx) — מחובר ופונקציונלי (Phase 5): טבלת משתמשים + עדכון תפקיד דרך RPC מנהל־בלבד | ✅ קיים |
| `Profile.jsx` | [ProfilePage.tsx](src/pages/ProfilePage.tsx) — מחובר ופונקציונלי (Phase 5). הקובץ הישן `Profile.tsx` נמחק | ✅ קיים |
| `EditNameSheet.jsx` | — | ❌ לא קיים (לא נדרש ל־DoD של אף Phase; פרופיל תומך כרגע רק בצפייה + התנתקות) |
| `GuardNameInput.jsx` (autocomplete + קישור ל־UserID) | `GuardNameRow` ב־[ShiftSetupPage.tsx](src/pages/ShiftSetupPage.tsx): שדה שם חופשי + `<select>` לקישור למשתמש רשום מ־`profiles` (לא combobox עם autocomplete אמיתי, אך פותר את הצורך המהותי — קישור `user_id`) | ✅ קיים (גרסה פשוטה) |
| `BottomTabBar.jsx` | [BottomNav.tsx](src/components/layout/BottomNav.tsx) — מחובר בפועל ב־AppShell (Phase 4), טאבים לחיצים ומסוננים לפי תפקיד | ✅ קיים |
| `base44.auth.me()` | טבלת `profiles` + פונקציית `get_my_role()` ב־Postgres | ✅ קיים |
| תפקידים Manager/Commander/Guard | `מנהל` / `אחמ"ש` / `מאבטח` | ✅ קיים |

---

## 3. ארכיטקטורת נתונים (Supabase) — מקורות אמת

> מקורות ה־SQL (בסדר יישום): [schema.sql](supabase/schema.sql), [rls.sql](supabase/rls.sql), [phase2_profiles.sql](supabase/phase2_profiles.sql), [phase3a_roster_boards_rls.sql](supabase/phase3a_roster_boards_rls.sql), [phase4_guard_names_on_roster_boards.sql](supabase/phase4_guard_names_on_roster_boards.sql), [phase5_guard_names_write_access.sql](supabase/phase5_guard_names_write_access.sql), [phase6_user_management_rls.sql](supabase/phase6_user_management_rls.sql), [phase7_profiles_visible_to_commander.sql](supabase/phase7_profiles_visible_to_commander.sql), [phase8_drop_shift_staffing.sql](supabase/phase8_drop_shift_staffing.sql). ראו גם [ROADMAP.md](ROADMAP.md) למטריצת ה־RLS הסופית.

### 3.1 `roster_boards` — **מקור האמת: מבנה + שמות**
עמודות: `id`, `shift_id` (text), `shift_type` (text), `cols` (jsonb `string[]` — תפקידים), `rows` (jsonb `{time, cells: Record<role,task>}[]`), `notes`, `published` (bool), `guard_names` (jsonb `Record<role, {name, user_id}>`, ברירת מחדל `{}`), `created_by`, `created_at`, `updated_at`.
- `guard_names` הוא מיקום השמות היחיד. הערך לכל תפקיד הוא `{name: string, user_id: string | null}` — `user_id` מקשר לתפקיד ב־`profiles`, נדרש עבור `PositionChangeNotifier` (סעיף 5).
- **RLS:** קריאה = כל `authenticated`. **עדכון מבנה** (`cols/rows/published/notes/shift_id/shift_type`) = מנהל בלבד, דרך מדיניות UPDATE רגילה. **עדכון `guard_names`** = מנהל או אחמ"ש, **רק** דרך RPC `update_roster_board_guard_names` (SECURITY DEFINER) — הפונקציה בודקת תפקיד ונוגעת אך ורק בעמודת `guard_names`; אין מדיניות UPDATE נפרדת לעמודה הזו (Postgres RLS הוא row-level, לא column-level). יצירה/מחיקה = מנהל בלבד.
- **כתיבה בקוד:** [rosterBoards.ts](src/lib/rosterBoards.ts) (`updateRosterBoard` למבנה, `updateRosterBoardGuardNames` לשמות דרך ה־RPC) ← [useRosterBoards.ts](src/hooks/useRosterBoards.ts) ← [AdminPanelPage](src/pages/AdminPanelPage.tsx), [RosterEditorPage](src/pages/RosterEditorPage.tsx), [ShiftSetupPage](src/pages/ShiftSetupPage.tsx).
- **קריאה בקוד:** אותה שכבה, וגם [useActiveBoard.ts](src/hooks/useActiveBoard.ts) (מנוי Realtime, קריאה ישירה דרך `supabase.from('roster_boards')` — לגיטימי, זו לא כתיבה).

### 3.2 `shift_staffing` — נמחקה (Phase 7)
הטבלה נמחקה לגמרי ([phase8_drop_shift_staffing.sql](supabase/phase8_drop_shift_staffing.sql)) לאחר שאושר שהיא ריקה (0 שורות) ושאין קוד שמפנה אליה. אין לשחזר אותה — כל השמות חיים ב־`roster_boards.guard_names` (3.1).

### 3.3 `profiles` — משתמש + תפקיד
עמודות: `id` (=`auth.users.id`), `email`, `full_name`, `app_role` (מוגבל ל־`מנהל`/`אחמ"ש`/`מאבטח`, ברירת מחדל `מאבטח`), timestamps.
- טריגרים: `handle_new_user_profile` (יוצר שורה אוטומטית בהרשמה), `set_profiles_updated_at`.
- פונקציות: `get_my_role()` (SECURITY DEFINER, קורא את השורה של המשתמש המחובר) — משמשת את כל ה־RLS מבוסס־תפקיד; `set_user_app_role(target_user_id, new_role)` (SECURITY DEFINER, מנהל בלבד) — הדרך היחידה לשנות `app_role`.
- **RLS:** קריאה = השורה של עצמך, **או** כל השורות אם `get_my_role() in ('מנהל','אחמ"ש')` (מנהל לניהול משתמשים, אחמ"ש לחיפוש בזמן קישור שם ב־Setup). עדכון עצמי = שדות שאינם `app_role` בלבד (משתמש לא יכול לקדם את עצמו ישירות); שינוי `app_role` עצמו קורה רק דרך ה־RPC, מנהל בלבד.
- **קריאה בקוד:** `fetchProfile` ב־[contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) (שורה עצמית), `fetchProfiles` ב־[profiles.ts](src/lib/profiles.ts) (כל השורות, ל־[UserManagementPage](src/pages/UserManagementPage.tsx) ול־autocomplete ב־[ShiftSetupPage](src/pages/ShiftSetupPage.tsx)).

### 3.4 חוק מקור־האמת (כלל האנטי־Base44) — מחייב
1. **מבנה + שמות** → רק `roster_boards`. שורה אחת של לו"ז מכילה את הכל: `cols`, `rows`, `guard_names`. אין טבלה שנייה לשמות.
2. **אסור נתיב קריאה/כתיבה כפול:** אין לקרוא או לכתוב שמות מכל מקור מלבד `roster_boards.guard_names`. מקום עריכה = מקום קריאה.
3. **ברירות מחדל** ([defaultRosterTemplates.ts](src/lib/defaultRosterTemplates.ts)) = זרע (seed) בלבד — מועתק אל `roster_boards` בעת "צור מתבנית". **אסור שיהיה נתיב קריאה בזמן ריצה** (זה בדיוק ה־`shiftConfig.js` שגרם לבאג ב־Base44).

---

## 4. מסך Setup (הזנת שמות) — ✅ פונקציונלי (Phase 2, 6)

**נקודת חיבור:** [ShiftSetupPage.tsx](src/pages/ShiftSetupPage.tsx) — מחובר בראוטר ופעיל.

התנהגות בפועל:
1. טאבים לפי קטגוריה (בוקר/צהריים/לילה) נבחרים אוטומטית לפי שעון אמת (`getActiveCategory`), ניתנים לשינוי ידני.
2. בחירת וריאנט מבין 5 התבניות: `morning_6` (6 מאבטחים), `morning_5` (5), `afternoon_4` (4), `afternoon_3` (3), `night` (2). הלוח שנטען הוא הפורסם עבור `shift_id` הנבחר, ואם אין — הטיוטה האחרונה.
3. עבור כל תפקיד ב־`board.cols` — שדה שם חופשי (`GuardNameRow`) + `<select>` לקישור אופציונלי למשתמש רשום מתוך `profiles`; בחירה ממלאת גם את השם. זו גרסה פשוטה של `GuardNameInput.jsx` (בלי autocomplete אמיתי, אך פותרת את קישור ה־`user_id`).
4. הרשאת עריכה: מנהל/אחמ"ש בלבד (`isAdmin || isCommander`); מאבטח = צפייה בלבד + כפתור "עבור לתצוגה חיה".
5. שמירה → `useUpdateGuardNames` → RPC `update_roster_board_guard_names` → מעבר ל־`/shift-live`.

---

## 5. מסך Live View (תצוגה חיה) — ✅ פונקציונלי (Phase 3, 6)

**נקודת חיבור:** [ShiftLivePage.tsx](src/pages/ShiftLivePage.tsx) — מחובר בראוטר ופעיל.

התנהגות בפועל:
1. **חישוב משמרת פעילה לפי שעון אמת בלבד** (לא ניווט ידני): `getActiveCategory()` ממפה שעה → קטגוריה → `SHIFT_IDS_BY_CATEGORY` → נשלף הלו"ז ה**מפורסם** (`published = true`) דרך [useActiveBoard.ts](src/hooks/useActiveBoard.ts).
2. **בלוק זמן נוכחי:** השורה האחרונה שזמנה ≤ עכשיו (`getCurrentBlock` ב־[shiftBlocks.ts](src/lib/shiftBlocks.ts), עם טיפול בגלישת חצות למשמרת לילה דרך `toShiftMinutes`).
3. **Realtime:** מנוי `postgres_changes` על `roster_boards` בלבד — מכסה גם מבנה, גם פרסום, וגם שינויי שמות, כי הכל באותה שורה.
4. **מקור השמות בתצוגה = `roster_boards.guard_names[role].name`.**
5. **התראת שינוי עמדה** ([PositionChangeNotifier.tsx](src/components/PositionChangeNotifier.tsx)): מותקן ב־AppShell (רץ בכל מסך, לא רק ב־Live), פעיל למאבטח בלבד. מוצא את התפקיד המקושר ל־`user.id` דרך `guard_names`, משווה `cells[role]` בין הבלוק הנוכחי לבלוק הבא (`getNextBlock`), ואם שונה והבלוק הבא מתחיל בעוד 0–5 דקות — Toast + Browser Notification, פעם אחת לכל מעבר (מפתח ייחודי מונע כפילות). לא שולח אם העמדה זהה.

---

## 6. ניהול משתמשים והרשאות — ✅ פונקציונלי (Phase 5)

- **מצב התחברות + תפקיד:** [contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) — טוען session מ־Supabase, שולף `profiles`, מחשב `isAdmin/isCommander/isGuard`, ומטפל במצבי פרופיל (`missing/invalid/error`).
- **הגנת דפים:** [ProtectedRoute.tsx](src/components/routes/ProtectedRoute.tsx) (מחייב session + פרופיל תקין) עוטף הכל; [AdminRoute.tsx](src/components/routes/AdminRoute.tsx) (מחייב `isAdmin`) עוטף `/admin`, `/roster-editor`, `/users`.
- **ניהול משתמשים:** [UserManagementPage.tsx](src/pages/UserManagementPage.tsx) — טבלת כל המשתמשים (מדיניות SELECT פתוחה למנהל/אחמ"ש), `<select>` תפקיד לכל שורה (חסום לשורת המשתמש עצמו), שמירה דרך RPC `set_user_app_role` מנהל־בלבד. **אין עדיין** מודול הזמנות (יצירת משתמש חדש) — לא נדרש ב־DoD של אף Phase.
- **פרופיל:** [ProfilePage.tsx](src/pages/ProfilePage.tsx) — פרטים + תפקיד + התנתקות. **אין עדיין** `EditNameSheet` (עדכון שם עצמי) או מחיקת חשבון — לא נדרשו ב־DoD.

---

## 7. פערים מול Base44 (מעודכן לאחר Phase 0–7)

**לא קיים כלל (מודע, לא נדרש ב־DoD של אף Phase):**
- `EditNameSheet.jsx` — עדכון שם עצמי בפרופיל.
- מחיקת חשבון.
- מודול הזמנות (יצירת משתמש חדש דרך UserManagement) — ניהול תפקידים למשתמשים קיימים כן קיים.

**קיים בגרסה פשוטה מהמקור:**
- `GuardNameInput.jsx` — יש שדה שם + `<select>` לקישור `user_id`, אבל לא combobox עם autocomplete חי כמו במקור.
- `Permissions.can()` — בוליאנים `isAdmin/isCommander/isGuard` + שומרי ראוט, לא מודול מרוכז.

כל שאר הפערים שתועדו כאן במקור (עמודת `guard_names` חסרה, שני עצי קוד מנותקים, `PositionChangeNotifier` לא קיים, ניווט תחתון לא לחיץ, `UserManagement`/`Profile` כ־Placeholder, `shift_staffing` כפולה) **נסגרו** — ר' [ROADMAP.md](ROADMAP.md) לפירוט המימוש בכל Phase.

---

## 8. סיכונים וחוסר עקביות — סטטוס לאחר Phase 0–7

כל הסיכונים המקוריים שתועדו כאן (שני עצי קוד מנותקים, עמודת `guard_names` חסרה, RLS חוסם אחמ"ש, טיפוס `RosterBoard` כפול, כפילויות `AuthContext`/`shiftTime`/`AppShell`, `profiles` חוסם ניהול משתמשים, `shift_staffing` מוזנחת) **נסגרו** — פירוט המימוש והאימות החי לכל אחד נמצא ב־[ROADMAP.md](ROADMAP.md), בפסקת "מימוש" תחת ה־Phase הרלוונטי.

סיכונים/פערים שנותרו פתוחים במודע (לא נדרשו ב־DoD של אף Phase, ר' סעיף 7):
- אין combobox autocomplete אמיתי ב־Setup — יש `<select>` פשוט לקישור `user_id`.
- אין מודול הזמנות (יצירת משתמש חדש), עדכון שם עצמי (`EditNameSheet`), או מחיקת חשבון.
- אין ESLint מוגדר בפרויקט — רשת הביטחון היחידה כרגע היא `tsc -b` (typecheck) שרץ כחלק מ־`npm run build`.
