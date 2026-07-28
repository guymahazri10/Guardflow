# Shift Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the five hardcoded shift templates from a static TypeScript file into a Supabase table, and add a manager-only screen to edit each template's schedule grid (roles, time blocks, task text) directly from the app.

**Architecture:** A new `shift_templates` table (same `cols`/`rows` jsonb shape `roster_boards` already uses — no format translation anywhere) becomes the single source of truth for template content, seeded once via migration with the real current data. Three existing pages that only used templates for *display* text switch to reading that text from `src/constants/shifts.ts` instead (which already owns shift labels/hours) — this removes the dual-source-of-truth risk entirely rather than working around it. Only `AdminPanelPage`'s "create a new roster board" flow, which genuinely needs template *content*, moves to an async React Query hook. The new editor page reuses the existing pure spreadsheet-editing functions from `src/lib/rosterEditorUtils.ts` as-is.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, react-router-dom v6, @tanstack/react-query, Supabase (Postgres + RLS).

## Global Constraints

- **Editable in this feature:** each template's `cols` (roles) / `rows` (time blocks + cell text) only.
- **Not editable, not touched:** `shift_id`, display label, sub-label, hours, category — these stay owned by `src/constants/shifts.ts`, exactly as today.
- **No create, no delete.** Exactly five templates exist, one per existing `shift_id` (`morning_6`, `morning_5`, `afternoon_3`, `afternoon_4`, `night`). This screen edits content only.
- Access: manager only (`isAdmin` from `AuthContext`), via the existing `AdminRoute` guard — same pattern as every other manager-only screen.
- No test framework exists in this repo (no `test` script, no vitest/jest config, no `*.test.*` files). Verification throughout is `npx tsc -b` plus manual browser checks, matching how every other feature in this codebase has been verified.
- RTL layout, Hebrew UI text, existing Tailwind design tokens (`primary`, `card`, `btn-primary`, `danger`, etc.) — follow patterns in `AdminPanelPage.tsx` / `RosterEditorPage.tsx` exactly, introduce no new visual patterns.

---

### Task 1: Migration — `shift_templates` table, RLS, and seed data

**Files:**
- Create: `supabase/phase18_shift_templates.sql`

**Interfaces:**
- Produces: Postgres table `public.shift_templates(id uuid, shift_id text unique, cols jsonb, rows jsonb, notes text, updated_at timestamptz)`, seeded with exactly 5 rows (`shift_id` = `morning_6`, `morning_5`, `afternoon_3`, `afternoon_4`, `night`). Later tasks read/write this table exclusively through `src/lib/shiftTemplates.ts` (Task 3).

- [ ] **Step 1: Write the migration file**

Create `supabase/phase18_shift_templates.sql` with this exact content — the seed data below is the real, current content of the five templates in `src/lib/defaultRosterTemplates.ts`, extracted and validated (this exact SQL was test-inserted into a temporary table and rolled back to confirm it parses and each row's `cols`/`rows` array lengths match the source data: morning_6 → 7 cols/17 rows, morning_5 → 6/16, afternoon_3 → 4/17, afternoon_4 → 5/17, night → 3/17):

```sql
-- GuardFlow Phase 18 — shift_templates table
--
-- Moves the five shift templates (previously hardcoded in
-- src/lib/defaultRosterTemplates.ts) into the database so a manager can edit
-- their schedule content from the app. Only schedule content (cols/rows/
-- notes) lives here — display label/sub-label/hours/category stay owned by
-- src/constants/shifts.ts, same as before this migration. No create/delete
-- path exists in the app for this table; exactly five rows are seeded here
-- and stay that way.

create table public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  shift_id text not null unique,
  cols jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  notes text,
  updated_at timestamptz not null default now()
);

comment on table public.shift_templates is 'Editable schedule content (cols/rows) for each of the five fixed shift types. Display metadata (label, hours, category) stays in src/constants/shifts.ts, not here.';

alter table public.shift_templates enable row level security;

-- Any authenticated user may read templates (needed to seed a new roster
-- board from AdminPanelPage, same as roster_boards' own select policy).
create policy "shift_templates select authenticated"
  on public.shift_templates
  for select
  to authenticated
  using (true);

-- Only managers may edit template content. No insert/delete policy is
-- defined — RLS denies both by default, matching "no create, no delete"
-- for this table; the five rows are seeded once by this migration only.
create policy "shift_templates update manager"
  on public.shift_templates
  for update
  to authenticated
  using (public.get_my_role() = 'מנהל')
  with check (public.get_my_role() = 'מנהל');

insert into public.shift_templates (shift_id, cols, rows, notes) values
('morning_6', '["אחמ\"ש","מאבטח 1","מאבטח 2","מאבטח 3","מאבטח 4","מאבטח 5","מאבטח 6"]'::jsonb, '[{"time":"07:00","cells":{"אחמ\"ש":"ניהול בוקר פתיחת קמפוס","מאבטח 1":"סריקת לובי עליון","מאבטח 2":"סריקת לובי תחתון","מאבטח 3":"סריקת AB ארוך + פתיחת משרדי הנהלה","מאבטח 4":"סריקת CD ארוך + פתיחת גן ילדים","מאבטח 5":"סריקת EF ארוך","מאבטח 6":"סריקת חניונים רכובה"}},{"time":"07:30","cells":{"אחמ\"ש":"ניהול בוקר פתיחת קמפוס","מאבטח 1":"סריקת לובי עליון","מאבטח 2":"סריקת לובי תחתון","מאבטח 3":"סריקת AB ארוך + פתיחת משרדי הנהלה","מאבטח 4":"סריקת CD ארוך + פתיחת גן ילדים","מאבטח 5":"סריקת EF ארוך","מאבטח 6":"סריקת חניונים רכובה"}},{"time":"08:00","cells":{"אחמ\"ש":"שגרת בוקר","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"אבטחת עובדים - 3","מאבטח 4":"הפסקת אוכל","מאבטח 5":"כונן -1","מאבטח 6":"כניסת הורים וילדים לגן"}},{"time":"08:30","cells":{"אחמ\"ש":"שגרת בוקר","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"הפסקת אוכל","מאבטח 4":"אבטחת עובדים - 3","מאבטח 5":"הפסקת אוכל","מאבטח 6":"הפסקת אוכל"}},{"time":"09:00","cells":{"אחמ\"ש":"עמדת כיכר","מאבטח 1":"הפסקת אוכל","מאבטח 2":"כונן -1","מאבטח 3":"לובי עליון","מאבטח 4":"אבטחת עובדים - 3","מאבטח 5":"לובי תחתון","מאבטח 6":"הפסקת אוכל"}},{"time":"09:30","cells":{"אחמ\"ש":"עמדת כיכר","מאבטח 1":"אבטחת עובדים - 3","מאבטח 2":"הפסקת אוכל","מאבטח 3":"לובי עליון","מאבטח 4":"כונן -1","מאבטח 5":"לובי תחתון","מאבטח 6":"עמדת כיכר"}},{"time":"10:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"סריקת לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"כונן -1","מאבטח 4":"לובי עליון","מאבטח 5":"שובר שגרה","מאבטח 6":"עמדת כיכר"}},{"time":"10:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"סריקת לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"שובר שגרה","מאבטח 4":"כונן -1","מאבטח 5":"לובי עליון","מאבטח 6":"עמדת כיכר"}},{"time":"11:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי תחתון","מאבטח 2":"סריקת לובי תחתון - 3","מאבטח 3":"כונן -1","מאבטח 4":"לובי עליון","מאבטח 5":"שובר שגרה","מאבטח 6":"עמדת כיכר"}},{"time":"11:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי תחתון","מאבטח 2":"לובי תחתון","מאבטח 3":"אבטחת עובדים - 3","מאבטח 4":"לובי עליון","מאבטח 5":"כונן -1","מאבטח 6":"עמדת כיכר"}},{"time":"12:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"הפסקת אוכל","מאבטח 2":"לובי תחתון","מאבטח 3":"לובי עליון","מאבטח 4":"הפסקת אוכל","מאבטח 5":"אבטחת עובדים - 3","מאבטח 6":"הפסקת אוכל"}},{"time":"12:30","cells":{"אחמ\"ש":"עמדת כיכר","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"הפסקת אוכל","מאבטח 4":"לובי תחתון","מאבטח 5":"אבטחת עובדים - 3","מאבטח 6":"אבטחת עובדים - 3"}},{"time":"13:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי עליון","מאבטח 2":"הפסקת אוכל","מאבטח 3":"הפסקת אוכל","מאבטח 4":"לובי תחתון","מאבטח 5":"שובר שגרה","מאבטח 6":"סריקת חניונים רכובה"}},{"time":"13:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"כונן -1","מאבטח 2":"שובר שגרה","מאבטח 3":"אבטחת עובדים - 3","מאבטח 4":"לובי תחתון","מאבטח 5":"לובי עליון","מאבטח 6":"כונן -1"}},{"time":"14:00","cells":{"אחמ\"ש":"חפיפת משמרת","מאבטח 1":"לובי עליון","מאבטח 2":"לובי עליון","מאבטח 3":"לובי תחתון","מאבטח 4":"סריקת לובי תחתון","מאבטח 5":"סריקת לובי עליון","מאבטח 6":"עמדת כיכר"}},{"time":"14:30","cells":{"אחמ\"ש":"חפיפת משמרת","מאבטח 1":"שובר שגרה","מאבטח 2":"לובי תחתון","מאבטח 3":"כונן -1","מאבטח 4":"לובי תחתון","מאבטח 5":"שובר שגרה","מאבטח 6":"לובי תחתון"}},{"time":"15:00","cells":{"אחמ\"ש":"חילוף משמרת","מאבטח 1":"חילוף משמרת","מאבטח 2":"חילוף משמרת","מאבטח 3":"חילוף משמרת","מאבטח 4":"חילוף משמרת","מאבטח 5":"חילוף משמרת","מאבטח 6":"חילוף משמרת"}}]'::jsonb, 'משמרת בוקר 6 מאבטחים (07:00–15:00)'),
('morning_5', '["אחמ\"ש","מאבטח 1","מאבטח 2","מאבטח 3","מאבטח 4","מאבטח 5"]'::jsonb, '[{"time":"07:00","cells":{"אחמ\"ש":"ניהול בוקר פתיחת קמפוס","מאבטח 1":"סריקת פרימטר AB + פתיחת משרדי הנהלה","מאבטח 2":"סריקת פרימטר CD + לובי עליון + פתיחת גן ילדים","מאבטח 3":"סריקת פרימטר EFG","מאבטח 4":"סריקת פרימטר EFG","מאבטח 5":"סריקת חניונים רכובה"}},{"time":"07:30","cells":{"אחמ\"ש":"ניהול בוקר פתיחת קמפוס","מאבטח 1":"סריקת פרימטר AB + פתיחת משרדי הנהלה","מאבטח 2":"סריקת פרימטר CD + לובי עליון + פתיחת גן ילדים","מאבטח 3":"סריקת פרימטר EFG","מאבטח 4":"סריקת פרימטר EFG","מאבטח 5":"סריקת חניונים רכובה"}},{"time":"08:00","cells":{"אחמ\"ש":"שגרת בוקר - טופס רכב + עלייה","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"אבטחת עובדים -3","מאבטח 4":"אבטחת עובדים -3","מאבטח 5":"כניסת הורים וילדים לגן"}},{"time":"08:30","cells":{"אחמ\"ש":"שגרת בוקר - טופס רכב + עלייה","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"לובי תחתון","מאבטח 4":"הפסקת אוכל -1","מאבטח 5":"הפסקת אוכל"}},{"time":"09:00","cells":{"אחמ\"ש":"עמדת כיכר","מאבטח 1":"הפסקת אוכל -1","מאבטח 2":"אבטחת עובדים -3","מאבטח 3":"לובי עליון","מאבטח 4":"לובי תחתון","מאבטח 5":"עמדת כיכר"}},{"time":"09:30","cells":{"אחמ\"ש":"עמדת כיכר","מאבטח 1":"אבטחת עובדים -3","מאבטח 2":"לובי עליון","מאבטח 3":"לובי עליון","מאבטח 4":"הפסקת אוכל -1","מאבטח 5":"עמדת כיכר"}},{"time":"10:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי עליון","מאבטח 2":"סריקת לובי עליון","מאבטח 3":"כונן -1","מאבטח 4":"כונן - חדר תדריכים 2","מאבטח 5":"עמדת כיכר"}},{"time":"10:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי תחתון","מאבטח 2":"סריקת לובי תחתון","מאבטח 3":"לובי עליון","מאבטח 4":"לובי עליון","מאבטח 5":"עמדת כיכר"}},{"time":"11:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי תחתון","מאבטח 2":"לובי תחתון","מאבטח 3":"סריקת לובי תחתון","מאבטח 4":"אבטחת עובדים -3","מאבטח 5":"עמדת כיכר"}},{"time":"11:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"לובי תחתון","מאבטח 4":"הפסקת אוכל -1","מאבטח 5":"עמדת כיכר"}},{"time":"12:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"הפסקת אוכל -1","מאבטח 2":"אבטחת עובדים -3","מאבטח 3":"הפסקת אוכל -1","מאבטח 4":"לובי תחתון","מאבטח 5":"הפסקת אוכל"}},{"time":"12:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"אבטחת עובדים -3","מאבטח 2":"לובי עליון","מאבטח 3":"אבטחת עובדים -3","מאבטח 4":"אבטחת עובדים -3","מאבטח 5":"עמדת כיכר"}},{"time":"13:00","cells":{"אחמ\"ש":"עמדת כיכר","מאבטח 1":"הפסקת אוכל -1","מאבטח 2":"אבטחת עובדים -3","מאבטח 3":"אבטחת עובדים -3","מאבטח 4":"לובי תחתון","מאבטח 5":"סריקת חניונים רכובה"}},{"time":"13:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"אבטחת עובדים -3","מאבטח 2":"לובי עליון","מאבטח 3":"לובי עליון","מאבטח 4":"הפסקת אוכל -1","מאבטח 5":"עמדת כיכר"}},{"time":"14:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש + טופס קשרים","מאבטח 1":"לובי תחתון","מאבטח 2":"כונן - חדר תדריכים -2","מאבטח 3":"לובי עליון","מאבטח 4":"כונן - חדר תדריכים -2","מאבטח 5":"עמדת כיכר"}},{"time":"14:30","cells":{"אחמ\"ש":"חפיפת משמרת","מאבטח 1":"כונן - חדר תדריכים -2","מאבטח 2":"כונן - חדר תדריכים -2","מאבטח 3":"כונן - חדר תדריכים -2","מאבטח 4":"לובי עליון","מאבטח 5":"לובי עליון"}}]'::jsonb, 'משמרת בוקר 5 מאבטחים (07:00–15:00)'),
('afternoon_3', '["אחמ\"ש","מאבטח 1","מאבטח 2","מאבטח 3"]'::jsonb, '[{"time":"15:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש - כונן","מאבטח 1":"לובי תחתון","מאבטח 2":"סריקת פרימטר CD(קצר) + לובי תחתון","מאבטח 3":"לובי עליון"}},{"time":"15:30","cells":{"אחמ\"ש":"סריקת אחמ\"ש - כונן","מאבטח 1":"לובי תחתון","מאבטח 2":"סריקת פרימטר CD(קצר) + לובי תחתון","מאבטח 3":"לובי עליון"}},{"time":"16:00","cells":{"אחמ\"ש":"כונן","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"סריקת פרימטר EFG (קצר)"}},{"time":"16:30","cells":{"אחמ\"ש":"כונן","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"סריקת פרימטר EFG (קצר)"}},{"time":"17:00","cells":{"אחמ\"ש":"כונן","מאבטח 1":"סריקת פרימטר AB(קצר) + לובי עליון","מאבטח 2":"לובי עליון","מאבטח 3":"לובי תחתון"}},{"time":"17:30","cells":{"אחמ\"ש":"סריקת תקינות EFG+AB+CD","מאבטח 1":"סריקת פרימטר AB(קצר) + לובי עליון","מאבטח 2":"לובי עליון","מאבטח 3":"לובי תחתון"}},{"time":"18:00","cells":{"אחמ\"ש":"סריקת תקינות EFG+AB+CD","מאבטח 1":"לובי תחתון","מאבטח 2":"סגירת גן ילדים + כונן","מאבטח 3":"לובי עליון"}},{"time":"18:30","cells":{"אחמ\"ש":"סריקת תקינות EFG+AB+CD","מאבטח 1":"לובי תחתון","מאבטח 2":"סגירת גן ילדים + כונן","מאבטח 3":"לובי עליון"}},{"time":"19:00","cells":{"אחמ\"ש":"סריקת תקינות EFG+AB+CD","מאבטח 1":"לובי עליון","מאבטח 2":"סריקת תפעול","מאבטח 3":"כונן - חדר תדריכים"}},{"time":"19:30","cells":{"אחמ\"ש":"סריקת תקינות EFG+AB+CD","מאבטח 1":"לובי עליון","מאבטח 2":"סריקת תפעול","מאבטח 3":"כונן - חדר תדריכים"}},{"time":"20:00","cells":{"אחמ\"ש":"סריקת תקינות EFG+AB+CD","מאבטח 1":"כונן - חדר תדריכים","מאבטח 2":"לובי עליון","מאבטח 3":"בדיקת תקלות פתוחות"}},{"time":"20:30","cells":{"אחמ\"ש":"סריקת תקינות EFG+AB+CD","מאבטח 1":"כונן - חדר תדריכים","מאבטח 2":"לובי עליון","מאבטח 3":"בדיקת תקלות פתוחות"}},{"time":"21:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש","מאבטח 1":"סידור עמדת קבלה + בקרה","מאבטח 2":"כונן - חדר תדריכים","מאבטח 3":"לובי עליון"}},{"time":"21:30","cells":{"אחמ\"ש":"סריקת אחמ\"ש","מאבטח 1":"סידור עמדת קבלה + בקרה","מאבטח 2":"כונן - חדר תדריכים","מאבטח 3":"לובי עליון"}},{"time":"22:00","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סגירה מלאה פרימטר: AB + לובי עליון","מאבטח 2":"סגירה מלאה פרימטר: CD + לובי תחתון","מאבטח 3":"סגירה מלאה פרימטר: EFG"}},{"time":"22:30","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סגירה מלאה פרימטר: AB + לובי עליון","מאבטח 2":"סגירה מלאה פרימטר: CD + לובי תחתון","מאבטח 3":"סגירה מלאה פרימטר: EFG"}},{"time":"23:00","cells":{"אחמ\"ש":"חילוף משמרת","מאבטח 1":"סריקה ראשונה כולל קומות","מאבטח 2":"סריקה ראשונה כולל קומות","מאבטח 3":"סריקה ראשונה כולל קומות"}}]'::jsonb, 'משמרת צהריים 3 מאבטחים (15:00–23:00)'),
('afternoon_4', '["אחמ\"ש","מאבטח 1","מאבטח 2","מאבטח 3","מאבטח 4"]'::jsonb, '[{"time":"15:00","cells":{"אחמ\"ש":"פתיחת משמרת + סריקת אחמ\"ש + טופס חימוש","מאבטח 1":"סריקת פרימטר AB(קצר) + לובי עליון","מאבטח 2":"לובי עליון","מאבטח 3":"לובי תחתון","מאבטח 4":"סיור רכוב חניון + חיצוני"}},{"time":"15:30","cells":{"אחמ\"ש":"פתיחת משמרת + סריקת אחמ\"ש + טופס חימוש","מאבטח 1":"סריקת פרימטר AB(קצר) + לובי עליון","מאבטח 2":"לובי עליון","מאבטח 3":"לובי תחתון","מאבטח 4":"סיור רכוב חניון + חיצוני"}},{"time":"16:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש + טופס חימוש","מאבטח 1":"לובי תחתון","מאבטח 2":"סריקת פרימטר CD(קצר) + לובי תחתון","מאבטח 3":"לובי עליון","מאבטח 4":"עמדת כיכר"}},{"time":"16:30","cells":{"אחמ\"ש":"סריקת אחמ\"ש + טופס חימוש","מאבטח 1":"לובי תחתון","מאבטח 2":"סריקת פרימטר CD(קצר) + לובי תחתון","מאבטח 3":"לובי עליון","מאבטח 4":"עמדת כיכר"}},{"time":"17:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"סריקת פרימטר EFG (קצר)","מאבטח 4":"עמדה חיצונית עד מערבי"}},{"time":"17:30","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"לובי עליון","מאבטח 2":"לובי תחתון","מאבטח 3":"סריקת פרימטר EFG (קצר)","מאבטח 4":"עמדה חיצונית עד מערבי"}},{"time":"18:00","cells":{"אחמ\"ש":"ביקורות עמדה + רכב","מאבטח 1":"סגירת גן ילדים + כונן","מאבטח 2":"לובי עליון","מאבטח 3":"לובי תחתון","מאבטח 4":"עמדת כיכר"}},{"time":"18:30","cells":{"אחמ\"ש":"ביקורות עמדה + רכב","מאבטח 1":"סגירת גן ילדים + כונן","מאבטח 2":"לובי עליון","מאבטח 3":"לובי עליון","מאבטח 4":"עמדת כיכר"}},{"time":"19:00","cells":{"אחמ\"ש":"ביקורות עמדה + רכב","מאבטח 1":"סריקת תפעול רכובה","מאבטח 2":"כונן - חדר תדריכים","מאבטח 3":"לובי עליון","מאבטח 4":"עמדת כיכר"}},{"time":"19:30","cells":{"אחמ\"ש":"ביקורות עמדה + רכב","מאבטח 1":"סריקת תפעול רכובה","מאבטח 2":"כונן - חדר תדריכים","מאבטח 3":"לובי עליון","מאבטח 4":"עמדת כיכר"}},{"time":"20:00","cells":{"אחמ\"ש":"ביקורות עמדה + רכב","מאבטח 1":"לובי עליון","מאבטח 2":"סידור עמדת קבלה + בקרה","מאבטח 3":"כונן - חדר תדריכים","מאבטח 4":"סריקת חניונים רכובה"}},{"time":"20:30","cells":{"אחמ\"ש":"ביקורות עמדה + רכב","מאבטח 1":"לובי עליון","מאבטח 2":"סידור עמדת קבלה + בקרה","מאבטח 3":"כונן - חדר תדריכים","מאבטח 4":"סריקת חניונים רכובה"}},{"time":"21:00","cells":{"אחמ\"ש":"ביקורות עמדה","מאבטח 1":"כונן - חדר תדריכים","מאבטח 2":"לובי עליון","מאבטח 3":"לובי עליון","מאבטח 4":"עמדת כיכר"}},{"time":"21:30","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סגירה מלאה פרימטר: AB + לובי עליון","מאבטח 2":"סגירה מלאה פרימטר: CD + לובי תחתון","מאבטח 3":"סגירה מלאה פרימטר: EFG","מאבטח 4":"עמדת כיכר"}},{"time":"22:00","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סגירה מלאה פרימטר: AB + לובי עליון","מאבטח 2":"סגירה מלאה פרימטר: CD + לובי תחתון","מאבטח 3":"סגירה מלאה פרימטר: EFG","מאבטח 4":"עמדת כיכר"}},{"time":"22:30","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סגירה מלאה פרימטר: AB + לובי עליון","מאבטח 2":"סגירה מלאה פרימטר: CD + לובי תחתון","מאבטח 3":"סגירה מלאה פרימטר: EFG","מאבטח 4":"עמדת כיכר"}},{"time":"23:00","cells":{"אחמ\"ש":"צ''ק ליסט סגירת קמפוס + טופס","מאבטח 1":"סריקה ראשונה כולל קומות","מאבטח 2":"סריקה ראשונה כולל קומות","מאבטח 3":"סריקה ראשונה כולל קומות","מאבטח 4":"חילוף משמרת"}}]'::jsonb, 'משמרת צהריים 4 מאבטחים (15:00–23:00)'),
('night', '["אחמ\"ש","מאבטח 1","מאבטח 2"]'::jsonb, '[{"time":"23:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש סופ\"ש ולילה","מאבטח 1":"סריקת לובי תחתון + CD פרימטר","מאבטח 2":"סריקת לובי עליון + AB פרימטר"}},{"time":"23:30","cells":{"אחמ\"ש":"סריקת אחמ\"ש סופ\"ש ולילה","מאבטח 1":"סריקת לובי תחתון + CD פרימטר","מאבטח 2":"סריקת לובי עליון + AB פרימטר"}},{"time":"00:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש סופ\"ש ולילה","מאבטח 1":"סריקת לובי תחתון + CD פרימטר","מאבטח 2":"סריקת לובי עליון + AB פרימטר"}},{"time":"00:30","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סריקת לובי תחתון + CD פרימטר","מאבטח 2":"סריקת לובי עליון + AB פרימטר"}},{"time":"01:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש + EFG פרימטר","מאבטח 1":"לובי עליון","מאבטח 2":"כונן - לובי תחתון"}},{"time":"01:30","cells":{"אחמ\"ש":"סריקת אחמ\"ש + EFG פרימטר","מאבטח 1":"לובי עליון","מאבטח 2":"כונן - לובי תחתון"}},{"time":"02:00","cells":{"אחמ\"ש":"חילוף חדר בקרה","מאבטח 1":"כונן - לובי תחתון","מאבטח 2":"לובי עליון"}},{"time":"02:30","cells":{"אחמ\"ש":"חילוף חדר בקרה","מאבטח 1":"כונן - לובי תחתון","מאבטח 2":"לובי עליון"}},{"time":"03:00","cells":{"אחמ\"ש":"חילוף חדר בקרה","מאבטח 1":"כונן - לובי תחתון","מאבטח 2":"לובי עליון"}},{"time":"03:30","cells":{"אחמ\"ש":"חילוף חדר בקרה","מאבטח 1":"כונן - לובי תחתון","מאבטח 2":"לובי עליון"}},{"time":"04:00","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סריקת לובי תחתון + CD פרימטר","מאבטח 2":"סריקת לובי עליון + AB פרימטר"}},{"time":"04:30","cells":{"אחמ\"ש":"לובי עליון","מאבטח 1":"סריקת לובי תחתון + CD פרימטר","מאבטח 2":"סריקת לובי עליון + AB פרימטר"}},{"time":"05:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש + EFG פרימטר","מאבטח 1":"לובי עליון","מאבטח 2":"כונן - לובי תחתון"}},{"time":"05:30","cells":{"אחמ\"ש":"סריקת אחמ\"ש + EFG פרימטר","מאבטח 1":"לובי עליון","מאבטח 2":"כונן - לובי תחתון"}},{"time":"06:00","cells":{"אחמ\"ש":"סריקת אחמ\"ש + EFG פרימטר","מאבטח 1":"לובי עליון","מאבטח 2":"כונן - לובי תחתון"}},{"time":"06:30","cells":{"אחמ\"ש":"העברת משמרת","מאבטח 1":"סידור חדר תדריכים","מאבטח 2":"לובי עליון"}},{"time":"07:00","cells":{"אחמ\"ש":"חילוף משמרת","מאבטח 1":"חילוף משמרת","מאבטח 2":"חילוף משמרת"}}]'::jsonb, 'משמרת לילה / סופ"ש 2 מאבטחים (23:00–07:00)');
```

- [ ] **Step 2: Apply the migration**

Apply it to the Supabase project (via `mcp__supabase__apply_migration` with name `phase18_shift_templates` and the exact SQL above, or via the Supabase CLI if working locally — follow whichever this repo's established convention is; every prior `phaseN.sql` file in `supabase/` was applied this same way).

- [ ] **Step 3: Verify the seed data landed correctly**

Run this read-only query and confirm it returns exactly 5 rows with these `num_cols`/`num_rows` pairs:

```sql
select shift_id, jsonb_array_length(cols) as num_cols, jsonb_array_length(rows) as num_rows
from public.shift_templates order by shift_id;
```

Expected:
```
afternoon_3 | 4 | 17
afternoon_4 | 5 | 17
morning_5   | 6 | 16
morning_6   | 7 | 17
night       | 3 | 17
```

- [ ] **Step 4: Commit**

```bash
git add supabase/phase18_shift_templates.sql
git commit -m "$(cat <<'EOF'
Add shift_templates table, seeded from the current hardcoded templates

Moves the five shift templates' schedule content (roles, time blocks,
task text) into the database so a manager can edit it from the app
instead of requiring a code change and deploy. Only schedule content
lives here — display label/hours/category stay in
src/constants/shifts.ts, exactly as before. No insert/delete policy:
there are always exactly five rows, seeded once by this migration.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `shifts.ts` groundwork — fix night's label, add `getShiftFullTitle`

Three pages currently build their "משמרת X" title and "N מאבטחים · שעות" subtitle by combining `shifts.ts` data with the (soon to be removed) template's `label`/`subLabel`. This task adds the one small piece of display logic `shifts.ts` is currently missing, so those three pages (Tasks 4–6) can derive both strings from `shifts.ts` alone. Investigated and confirmed: `SHIFT_CATEGORIES.night.label` is `'לילה'` but the night shift's *current on-screen title* is `"משמרת לילה / סופ\"ש"` (from the old template's `label`, which doesn't fit the plain `` `משמרת ${category}` `` pattern the other four shifts use) — and `SHIFTS`'s `night` entry's own `label` field is just `'לילה'` (no guard count), unlike the other four entries which already bake the guard count into `label` (e.g. `'בוקר 6 מאבטחים'`). Both are fixed here.

**Files:**
- Modify: `src/constants/shifts.ts`

**Interfaces:**
- Produces: `export function getShiftFullTitle(shift: ShiftConfig): string` — Tasks 4, 5, 6, 7, 8 all use this for the "משמרת X" title text.

- [ ] **Step 1: Fix the `night` entry's `label` and add `getShiftFullTitle`**

In `src/constants/shifts.ts`, change the `night` entry inside the `SHIFTS` array (currently `label: 'לילה'`) to:

```ts
  {
    id: 'night',
    label: 'לילה 2 מאבטחים',
    category: 'night',
    startHour: 23,
    endHour: 7,
    color: '#6366f1',
    emoji: '🌙',
  },
```

(Only the `label` value changes, from `'לילה'` to `'לילה 2 מאבטחים'` — every other field on this entry is unchanged. This makes `getShiftShortLabel(night)` correctly return `"2 מאבטחים"` instead of falling back to the full `"לילה"`, matching the pattern every other shift already follows.)

Then add this new function at the end of the file, after `getShiftHoursLabel`:

```ts
/** Full display title for a shift, e.g. "משמרת בוקר" — except night, which
 *  keeps its existing "משמרת לילה / סופ"ש" wording (this shift also covers
 *  weekend day shifts, not just night, hence the suffix). */
export function getShiftFullTitle(shift: ShiftConfig): string {
  if (shift.category === 'night') {
    return 'משמרת לילה / סופ"ש'
  }
  return `משמרת ${SHIFT_CATEGORIES[shift.category].label}`
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean). This step alone can't cause a type error (only a string literal and one new exported function were added), but confirm it stays clean before moving on.

- [ ] **Step 3: Commit**

```bash
git add src/constants/shifts.ts
git commit -m "$(cat <<'EOF'
Add getShiftFullTitle and fix night's short-label guard count

night's SHIFTS entry was the one shift whose label didn't include a
guard count (e.g. "לילה" vs "בוקר 6 מאבטחים" for the others), so
getShiftShortLabel(night) fell back to the full "לילה" instead of "2
מאבטחים" like every other shift's short label. Fixed as groundwork for
the next few tasks, which stop reading display text from
defaultRosterTemplates.ts and need shifts.ts to be a complete source on
its own — including the "משמרת לילה / סופ"ש" title wording that only
lived in the (soon to be removed) template's label field until now.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Data access — `src/lib/shiftTemplates.ts` and `src/hooks/useShiftTemplates.ts`

**Files:**
- Create: `src/lib/shiftTemplates.ts`
- Create: `src/hooks/useShiftTemplates.ts`

**Interfaces:**
- Consumes: `supabase` client from `src/lib/supabase.ts`; `RosterBoardRow` type from `src/lib/rosterBoards.ts` (the `cols`/`rows` shape is identical, reused rather than redefined).
- Produces: `export type ShiftTemplate = { id: string; shift_id: string; cols: string[]; rows: RosterBoardRow[]; notes: string | null; updated_at: string }`; `export type UpdateShiftTemplateInput = { cols: string[]; rows: RosterBoardRow[]; notes?: string | null }`; `export async function fetchShiftTemplates(): Promise<ShiftTemplate[]>`; `export async function fetchShiftTemplateByShiftId(shiftId: string): Promise<ShiftTemplate | null>`; `export async function updateShiftTemplate(shiftId: string, input: UpdateShiftTemplateInput): Promise<ShiftTemplate>`; and hooks `export function useShiftTemplates()`, `export function useShiftTemplate(shiftId: string | null | undefined)`, `export function useUpdateShiftTemplate()` — Tasks 6, 7, 8 consume these.

- [ ] **Step 1: Create `src/lib/shiftTemplates.ts`**

```ts
import { supabase } from './supabase'
import type { RosterBoardRow } from './rosterBoards'

export type ShiftTemplate = {
  id: string
  shift_id: string
  cols: string[]
  rows: RosterBoardRow[]
  notes: string | null
  updated_at: string
}

export type UpdateShiftTemplateInput = {
  cols: string[]
  rows: RosterBoardRow[]
  notes?: string | null
}

type ShiftTemplateRecord = Omit<ShiftTemplate, 'cols' | 'rows'> & {
  cols: unknown
  rows: unknown
}

const SHIFT_TEMPLATE_SELECT = 'id, shift_id, cols, rows, notes, updated_at'

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Invalid shift_templates.${fieldName} data.`)
  }

  return value
}

function isRosterBoardRow(value: unknown): value is RosterBoardRow {
  if (!value || typeof value !== 'object') {
    return false
  }

  const row = value as { time?: unknown; cells?: unknown }

  return (
    typeof row.time === 'string' &&
    !!row.cells &&
    typeof row.cells === 'object' &&
    !Array.isArray(row.cells) &&
    Object.values(row.cells).every((cell) => typeof cell === 'string')
  )
}

function parseRows(value: unknown): RosterBoardRow[] {
  if (!Array.isArray(value) || !value.every(isRosterBoardRow)) {
    throw new Error('Invalid shift_templates.rows data.')
  }

  return value
}

function mapShiftTemplate(record: ShiftTemplateRecord): ShiftTemplate {
  return {
    ...record,
    cols: parseStringArray(record.cols, 'cols'),
    rows: parseRows(record.rows),
  }
}

export async function fetchShiftTemplates(): Promise<ShiftTemplate[]> {
  const { data, error } = await supabase
    .from('shift_templates')
    .select(SHIFT_TEMPLATE_SELECT)
    .order('shift_id', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift templates', error))
  }

  return (data ?? []).map((record) => mapShiftTemplate(record as ShiftTemplateRecord))
}

export async function fetchShiftTemplateByShiftId(shiftId: string): Promise<ShiftTemplate | null> {
  const { data, error } = await supabase
    .from('shift_templates')
    .select(SHIFT_TEMPLATE_SELECT)
    .eq('shift_id', shiftId)
    .maybeSingle()

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift template', error))
  }

  return data ? mapShiftTemplate(data as ShiftTemplateRecord) : null
}

export async function updateShiftTemplate(
  shiftId: string,
  input: UpdateShiftTemplateInput,
): Promise<ShiftTemplate> {
  const { data, error } = await supabase
    .from('shift_templates')
    .update({ cols: input.cols, rows: input.rows, notes: input.notes ?? null })
    .eq('shift_id', shiftId)
    .select(SHIFT_TEMPLATE_SELECT)
    .single()

  if (error) {
    throw new Error(getErrorMessage('Failed to update shift template', error))
  }

  return mapShiftTemplate(data as ShiftTemplateRecord)
}
```

- [ ] **Step 2: Create `src/hooks/useShiftTemplates.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchShiftTemplateByShiftId,
  fetchShiftTemplates,
  updateShiftTemplate,
  type ShiftTemplate,
  type UpdateShiftTemplateInput,
} from '../lib/shiftTemplates'

export const shiftTemplateKeys = {
  all: ['shiftTemplates'] as const,
  list: () => [...shiftTemplateKeys.all, 'list'] as const,
  detail: (shiftId: string) => [...shiftTemplateKeys.all, 'detail', shiftId] as const,
}

type UpdateShiftTemplateVariables = {
  shiftId: string
  input: UpdateShiftTemplateInput
}

export function useShiftTemplates() {
  return useQuery({
    queryKey: shiftTemplateKeys.list(),
    queryFn: fetchShiftTemplates,
  })
}

export function useShiftTemplate(shiftId: string | null | undefined) {
  return useQuery({
    queryKey: shiftTemplateKeys.detail(shiftId ?? ''),
    queryFn: () => fetchShiftTemplateByShiftId(shiftId ?? ''),
    enabled: Boolean(shiftId),
  })
}

export function useUpdateShiftTemplate() {
  const queryClient = useQueryClient()

  return useMutation<ShiftTemplate, Error, UpdateShiftTemplateVariables>({
    mutationFn: ({ shiftId, input }) => updateShiftTemplate(shiftId, input),
    onSuccess: async (_template, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.list() }),
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.detail(variables.shiftId) }),
      ])
    },
  })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/lib/shiftTemplates.ts src/hooks/useShiftTemplates.ts
git commit -m "$(cat <<'EOF'
Add shift_templates data access and React Query hooks

Mirrors the existing roster_boards data-access pattern exactly
(src/lib/rosterBoards.ts / src/hooks/useRosterBoards.ts) — same
runtime-validated jsonb parsing, same query-key/mutation-invalidation
shape. Nothing consumes this yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Stop `RosterEditorPage` reading templates for display

**Files:**
- Modify: `src/pages/RosterEditorPage.tsx`

**Interfaces:**
- Consumes: `getShiftFullTitle`, `getShiftShortLabel` from `src/constants/shifts.ts` (the latter already existed; the former is new from Task 2).

- [ ] **Step 1: Remove the `defaultRosterTemplates` import and its one use**

In `src/pages/RosterEditorPage.tsx`, remove this import line:

```ts
import { findDefaultRosterTemplateByShiftId } from '../lib/defaultRosterTemplates'
```

Add `getShiftFullTitle` to the existing import from `../constants/shifts` (currently `import { SHIFT_CATEGORIES, getShiftById, getShiftHoursLabel } from '../constants/shifts'`) so it reads:

```ts
import { SHIFT_CATEGORIES, getShiftById, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
```

Then replace these lines (currently around line 72–78):

```ts
  const shift = board ? getShiftById(board.shift_id) : undefined
  const template = board ? findDefaultRosterTemplateByShiftId(board.shift_id) : null
  const title = template?.label ?? (shift ? `משמרת ${SHIFT_CATEGORIES[shift.category].label}` : 'לו״ז')
  // Canonical category hours, not the template's real-world hours (which include a 30min handover buffer).
  const hours = shift ? getShiftHoursLabel(shift) : ''
  const subtitle = template ? `${template.subLabel} · ${hours}` : ''
  const typeLabel = shift ? `${SHIFT_CATEGORIES[shift.category].label} – ${template?.subLabel ?? ''}` : ''
```

with:

```ts
  const shift = board ? getShiftById(board.shift_id) : undefined
  const title = shift ? getShiftFullTitle(shift) : 'לו״ז'
  // Canonical category hours, not the board's real-world hours (which include a 30min handover buffer).
  const hours = shift ? getShiftHoursLabel(shift) : ''
  const subtitle = shift ? `${getShiftShortLabel(shift)} · ${hours}` : ''
  const typeLabel = shift ? `${SHIFT_CATEGORIES[shift.category].label} – ${getShiftShortLabel(shift)}` : ''
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 3: Visual verification**

Using the Browser pane on the local dev server, log in as a manager, open `/admin`, select an existing published board, click through to its `/roster-editor?id=...` page, and confirm the hero card's title/subtitle text is unchanged from before this change (e.g. for the morning 6-guard board: title "משמרת בוקר", subtitle "6 מאבטחים · 07:00–15:00"). Check at least the morning and night boards specifically, since night's wording is the one that changed source (Task 2) — confirm it still reads "משמרת לילה / סופ״ש" and "2 מאבטחים · 23:00–07:00".

- [ ] **Step 4: Commit**

```bash
git add src/pages/RosterEditorPage.tsx
git commit -m "$(cat <<'EOF'
Read RosterEditorPage's title/subtitle from shifts.ts, not templates

The page only ever used the template for display text (title/subtitle),
never for editing — it edits an existing roster_boards row, not a
template. Reading purely from shifts.ts (via the new getShiftFullTitle)
removes its only dependency on defaultRosterTemplates.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Stop `ShiftLivePage` reading templates for display

**Files:**
- Modify: `src/pages/ShiftLivePage.tsx`

**Interfaces:**
- Consumes: `getShiftFullTitle` from `src/constants/shifts.ts` (Task 2).

- [ ] **Step 1: Remove the `defaultRosterTemplates` import and its one use**

In `src/pages/ShiftLivePage.tsx`, remove this import line:

```ts
import { findDefaultRosterTemplateByShiftId } from '../lib/defaultRosterTemplates'
```

Add `getShiftFullTitle` to the existing import from `../constants/shifts` (currently `import { SHIFT_CATEGORIES, getShiftById, getShiftHoursLabel } from '../constants/shifts'`) so it reads:

```ts
import { SHIFT_CATEGORIES, getShiftById, getShiftFullTitle, getShiftHoursLabel } from '../constants/shifts'
```

Then replace these lines (currently around line 20–25):

```ts
  const template = board ? findDefaultRosterTemplateByShiftId(board.shift_id) : null
  const shift = board ? getShiftById(board.shift_id) : undefined
  const shiftLabel = template?.label ?? `משמרת ${catConfig.label}`
  // Canonical category hours (07:00–15:00 / 15:00–23:00 / 23:00–07:00), not the
  // template's real-world hours which include a 30min handover buffer.
  const shiftHours = shift ? getShiftHoursLabel(shift) : catConfig.hours
```

with:

```ts
  const shift = board ? getShiftById(board.shift_id) : undefined
  const shiftLabel = shift ? getShiftFullTitle(shift) : `משמרת ${catConfig.label}`
  // Canonical category hours (07:00–15:00 / 15:00–23:00 / 23:00–07:00), not the
  // board's real-world hours which include a 30min handover buffer.
  const shiftHours = shift ? getShiftHoursLabel(shift) : catConfig.hours
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 3: Visual verification**

Using the Browser pane on the local dev server, log in and open `/shift-live`. Confirm the shift label text shown near the clock is unchanged from before this change, for whichever category is currently active (compare against a screenshot taken before this task if unsure — the exact wording must not change, only its source did).

- [ ] **Step 4: Commit**

```bash
git add src/pages/ShiftLivePage.tsx
git commit -m "$(cat <<'EOF'
Read ShiftLivePage's shift label from shifts.ts, not templates

Same fix as the previous RosterEditorPage commit: this was
display-only, never used for editing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `AdminPanelPage` — sync display, async seed data, new nav button

**Files:**
- Modify: `src/pages/AdminPanelPage.tsx`

**Interfaces:**
- Consumes: `getShiftFullTitle`, `getShiftShortLabel` from `src/constants/shifts.ts`; `useShiftTemplates` from `src/hooks/useShiftTemplates.ts` (Task 3).

`AdminPanelPage` used the template for two different things — display text (now moves to sync `shifts.ts` reads, same fix as Tasks 4–5) and the actual seed content for a newly created `roster_boards` row (this one genuinely needs the new async hook, since it copies real `cols`/`rows`/`notes`).

- [ ] **Step 1: Replace the `defaultRosterTemplates` import**

Remove this import:

```ts
import { findDefaultRosterTemplateByShiftId } from '../lib/defaultRosterTemplates'
```

Replace it with:

```ts
import { useShiftTemplates } from '../hooks/useShiftTemplates'
```

Replace the existing import from `../constants/shifts` (currently `import { SHIFT_CATEGORIES, SHIFTS, getShiftHoursLabel, type ShiftConfig } from '../constants/shifts'`) with:

```ts
import { SHIFTS, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel, type ShiftConfig } from '../constants/shifts'
```

(`SHIFT_CATEGORIES` is dropped here already — confirmed via `grep -n "SHIFT_CATEGORIES" src/pages/AdminPanelPage.tsx` that its only use in this file is inside the function replaced in Step 2 below.)

- [ ] **Step 2: Simplify `buildShiftDisplay` to a pure `shifts.ts` read**

Replace this function (currently around line 15–29):

```ts
/** Guard count comes from defaultRosterTemplates.ts (subLabel); hours use the
 *  canonical category boundary (07:00–15:00 / 15:00–23:00 / 23:00–07:00),
 *  not the template's real-world hours which include a 30min handover
 *  buffer (e.g. morning_6 actually ends 15:30) — that buffer is real
 *  schedule data, not something we want surfaced as "the shift's hours". */
function buildShiftDisplay(shift: ShiftConfig): ShiftDisplay {
  const template = findDefaultRosterTemplateByShiftId(shift.id)
  const hours = getShiftHoursLabel(shift)

  return {
    shift,
    title: template?.label ?? `משמרת ${SHIFT_CATEGORIES[shift.category].label}`,
    subtitle: template ? `${template.subLabel} · ${hours}` : `${shift.label} · ${hours}`,
  }
}
```

with:

```ts
function buildShiftDisplay(shift: ShiftConfig): ShiftDisplay {
  return {
    shift,
    title: getShiftFullTitle(shift),
    subtitle: `${getShiftShortLabel(shift)} · ${getShiftHoursLabel(shift)}`,
  }
}
```

(`SHIFT_DISPLAYS = SHIFTS.map(buildShiftDisplay)` below it stays as-is — only the function body changed, the import was already fixed in Step 1.)

- [ ] **Step 3: Switch `handlePickFromSheet`'s seed lookup to the new hook**

Inside the `AdminPanelPage` component function, add the query near the other hooks (after `const deleteRosterBoardMutation = useDeleteRosterBoard()`):

```ts
  const shiftTemplatesQuery = useShiftTemplates()
```

Then replace this block inside `handlePickFromSheet` (currently around line 89–106):

```ts
    const template = findDefaultRosterTemplateByShiftId(shiftId)

    if (!template) {
      setActionError('לא נמצאה תבנית למשמרת שנבחרה.')
      return
    }

    setCreatingShiftId(shiftId)

    try {
      const board = await createRosterBoardMutation.mutateAsync({
        shift_id: template.shift_id,
        shift_type: template.shift_type,
        cols: template.cols,
        rows: template.rows,
        notes: template.notes,
        published: false,
      })
```

with:

```ts
    const template = shiftTemplatesQuery.data?.find((t) => t.shift_id === shiftId)

    if (!template) {
      setActionError('לא נמצאה תבנית למשמרת שנבחרה.')
      return
    }

    const shift = SHIFTS.find((s) => s.id === shiftId)

    if (!shift) {
      setActionError('לא נמצאה תבנית למשמרת שנבחרה.')
      return
    }

    setCreatingShiftId(shiftId)

    try {
      const board = await createRosterBoardMutation.mutateAsync({
        shift_id: template.shift_id,
        shift_type: shift.category,
        cols: template.cols,
        rows: template.rows,
        notes: template.notes,
        published: false,
      })
```

(`template.shift_type` no longer exists on `ShiftTemplate` — Task 3's type doesn't carry it, since it's category metadata that belongs to `shifts.ts`, same reasoning as everywhere else in this plan. `shift.category` from `SHIFTS`/`ShiftConfig` is the equivalent value `roster_boards.shift_type` expects, e.g. `'morning'`.)

- [ ] **Step 4: Add the "תבניות משמרת" nav button**

Replace the header block (currently around line 136–144):

```tsx
      <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">ניהול לו״זים</h1>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold text-primary bg-primary-light border border-primary/20 rounded-xl active:opacity-80 transition-opacity"
        >
          <span className="text-base leading-none">+</span> לוז חדש
        </button>
      </div>
```

with:

```tsx
      <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">ניהול לו״זים</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/shift-templates')}
            className="px-3.5 py-2 text-sm font-bold text-primary bg-primary-light border border-primary/20 rounded-xl active:opacity-80 transition-opacity"
          >
            תבניות משמרת
          </button>
          <button
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold text-primary bg-primary-light border border-primary/20 rounded-xl active:opacity-80 transition-opacity"
          >
            <span className="text-base leading-none">+</span> לוז חדש
          </button>
        </div>
      </div>
```

(`navigate` is already imported and in scope — `AdminPanelPage` already calls `useNavigate()` at the top of the component for `handleOpenEditor`.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 6: Visual verification**

Using the Browser pane, log in as a manager and open `/admin`. Confirm: (a) the "תבניות משמרת" button appears next to "לוז חדש" and is styled identically; (b) every existing board card's title/subtitle text is unchanged from before this task; (c) the shift picker bottom sheet (tap "לוז חדש") still lists all 5 shift types with correct titles/subtitles; (d) picking a shift type that doesn't have a board yet still successfully creates one — confirm the newly created board's content matches what the old hardcoded template had (spot-check a couple of cells against `src/lib/defaultRosterTemplates.ts`'s current content, or against Task 1's seed data, before it's deleted in Task 10).

- [ ] **Step 7: Commit**

```bash
git add src/pages/AdminPanelPage.tsx
git commit -m "$(cat <<'EOF'
Move AdminPanelPage off defaultRosterTemplates.ts

Display text (title/subtitle) now reads shifts.ts directly and stays
fully synchronous — it no longer needs template data at all. The one
place that genuinely needs template content, creating a new roster
board's seed data, now reads it from the new shift_templates table via
useShiftTemplates(). Also adds the "תבניות משמרת" nav button next to
"לוז חדש", linking to the new editor screen (built in a later task).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ShiftTemplatesPage` — the list screen

**Files:**
- Create: `src/pages/ShiftTemplatesPage.tsx`

**Interfaces:**
- Consumes: `useShiftTemplates` from `src/hooks/useShiftTemplates.ts` (Task 3); `SHIFTS`, `getShiftFullTitle`, `getShiftShortLabel`, `getShiftHoursLabel` from `src/constants/shifts.ts`.
- Produces: `export function ShiftTemplatesPage()` — Task 9 (routing) renders this at `/shift-templates`. Each card navigates to `/shift-templates?shiftId=<id>`, which Task 8's editor reads.

- [ ] **Step 1: Create `src/pages/ShiftTemplatesPage.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { useShiftTemplates } from '../hooks/useShiftTemplates'
import { SHIFTS, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'

export function ShiftTemplatesPage() {
  const navigate = useNavigate()
  const templatesQuery = useShiftTemplates()

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      <div className="bg-white border-b border-border px-4 pt-5 pb-4">
        <h1 className="text-xl font-bold text-text-primary">תבניות משמרת</h1>
        <p className="text-text-secondary text-sm mt-0.5">בחר תבנית כדי לערוך את תוכן הלוח שלה</p>
      </div>

      {templatesQuery.isError && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          טעינת התבניות נכשלה. נסה לרענן את העמוד.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 pb-6">
        {templatesQuery.isLoading ? (
          <ListSkeleton />
        ) : (
          SHIFTS.map((shift) => {
            const template = templatesQuery.data?.find((t) => t.shift_id === shift.id)

            return (
              <button
                key={shift.id}
                onClick={() => navigate(`/shift-templates?shiftId=${encodeURIComponent(shift.id)}`)}
                className="card p-3.5 text-right flex items-center gap-3 transition-all active:scale-[0.98]"
              >
                <div className="flex-1 text-right min-w-0">
                  <p className="text-sm font-bold text-text-primary">{getShiftFullTitle(shift)}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {getShiftShortLabel(shift)} · {getShiftHoursLabel(shift)}
                  </p>
                </div>
                <span className="text-[11px] text-text-muted shrink-0">
                  {template ? `${template.cols.length} תפקידים` : '—'}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card p-3.5 flex items-center gap-3 animate-pulse">
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3.5 w-24 bg-border rounded" />
            <div className="h-3 w-32 bg-border rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean). (This page isn't routed yet — Task 9 — so there's nothing to visually verify until then.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/ShiftTemplatesPage.tsx
git commit -m "$(cat <<'EOF'
Add ShiftTemplatesPage (list view, not yet routed)

Five cards, one per shifts.ts entry, each showing its live column count
from the new shift_templates table and linking to
/shift-templates?shiftId=<id> for editing. No create/delete UI, per
spec — there are always exactly five templates.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `ShiftTemplateEditorPage` — the spreadsheet editor

**Files:**
- Create: `src/pages/ShiftTemplateEditorPage.tsx`

**Interfaces:**
- Consumes: `useShiftTemplate`, `useUpdateShiftTemplate` from `src/hooks/useShiftTemplates.ts` (Task 3); `getShiftById`, `getShiftFullTitle`, `getShiftShortLabel`, `getShiftHoursLabel` from `src/constants/shifts.ts`; `addColumn`, `addTimeRow`, `removeColumn`, `removeTimeRow`, `renameColumn`, `updateCell` from `src/lib/rosterEditorUtils.ts` (Task 3's `ColRowResult` return shape: `{ cols: string[]; rows: RosterBoardRow[] }`); `RosterBoardRow` from `src/lib/rosterBoards.ts`.
- Produces: `export function ShiftTemplateEditorPage()` — Task 9 renders this at `/shift-templates` when a `?shiftId=` query param is present.

- [ ] **Step 1: Create `src/pages/ShiftTemplateEditorPage.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useShiftTemplate, useUpdateShiftTemplate } from '../hooks/useShiftTemplates'
import type { RosterBoardRow } from '../lib/rosterBoards'
import { addColumn, addTimeRow, removeColumn, removeTimeRow, renameColumn, updateCell } from '../lib/rosterEditorUtils'
import { getShiftById, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

/** Next half-hour slot after the last row, wrapping past midnight. */
function nextTimeSlot(rows: RosterBoardRow[]): string {
  const lastTime = rows.length > 0 ? rows[rows.length - 1].time : '00:00'
  const [h, m] = lastTime.split(':').map(Number)
  const totalMinutes = (h * 60 + m + 30) % (24 * 60)
  const nh = Math.floor(totalMinutes / 60)
  const nm = totalMinutes % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
      <h1 className="text-xl font-bold text-text-primary">עריכת תבנית</h1>
      <button onClick={onBack} className="text-sm font-medium text-primary flex items-center gap-1 active:opacity-70">
        חזור לרשימה ←
      </button>
    </div>
  )
}

export function ShiftTemplateEditorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shiftId = searchParams.get('shiftId')
  const shift = shiftId ? getShiftById(shiftId) : undefined

  const templateQuery = useShiftTemplate(shiftId)
  const updateMutation = useUpdateShiftTemplate()

  const [loadedShiftId, setLoadedShiftId] = useState<string | null>(null)
  const [cols, setCols] = useState<string[]>([])
  const [rows, setRows] = useState<RosterBoardRow[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const cellInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const template = templateQuery.data ?? null
  const isSaving = updateMutation.isPending

  // Re-initializes only when the loaded shift actually changes, not on every
  // background refetch — same reasoning as RosterEditorPage's board sync.
  useEffect(() => {
    if (!template || loadedShiftId === template.shift_id) return
    setCols(template.cols)
    setRows(template.rows)
    setLoadedShiftId(template.shift_id)
    setActionError(null)
  }, [template, loadedShiftId])

  function handleAddColumn() {
    const name = `עמדה ${cols.length + 1}`
    const result = addColumn(cols, rows, name)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleRemoveColumn(columnName: string) {
    const result = removeColumn(cols, rows, columnName)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleColumnRenameBlur(oldName: string, value: string, input: HTMLInputElement) {
    const trimmedValue = value.trim()

    if (!trimmedValue || (trimmedValue !== oldName && cols.includes(trimmedValue))) {
      input.value = oldName
      return
    }

    const result = renameColumn(cols, rows, oldName, trimmedValue)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleAddTimeRow() {
    setRows(addTimeRow(rows, nextTimeSlot(rows)))
  }

  function handleRemoveTimeRow(time: string) {
    setRows(removeTimeRow(rows, time))
  }

  function handleUpdateCell(rowTime: string, columnName: string, value: string) {
    setRows(updateCell(rows, rowTime, columnName, value))
  }

  function handleCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) {
    if (event.key === 'Tab') {
      event.preventDefault()
      const nextCi = ci + 1 < cols.length ? ci + 1 : 0
      const nextRi = ci + 1 < cols.length ? ri : ri + 1
      cellInputRefs.current[`${nextRi}-${nextCi}`]?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      cellInputRefs.current[`${ri + 1}-${ci}`]?.focus()
    }
  }

  async function handleSave() {
    if (!shiftId) return

    setActionError(null)

    try {
      await updateMutation.mutateAsync({ shiftId, input: { cols, rows, notes: template?.notes ?? null } })
      toast.success('נשמר בהצלחה!')
      navigate('/shift-templates')
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  if (!shiftId || !shift) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">חסר מזהה משמרת לעריכה.</div>
        </div>
      </div>
    )
  }

  if (templateQuery.isLoading) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">טוען תבנית...</div>
        </div>
      </div>
    )
  }

  if (templateQuery.isError || !template) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">
            {templateQuery.isError ? 'טעינת התבנית נכשלה.' : 'התבנית לא נמצאה.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      <TopBar onBack={() => navigate('/shift-templates')} />

      <div className="px-4 pt-4">
        <div className="rounded-card bg-primary text-white p-4">
          <p className="text-base font-bold">{getShiftFullTitle(shift)}</p>
          <p className="text-sm text-white/70 mt-1">
            {getShiftShortLabel(shift)} · {getShiftHoursLabel(shift)}
          </p>
        </div>

        {actionError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
        )}

        <button
          onClick={() => {
            void handleSave()
          }}
          disabled={isSaving}
          className="btn-primary w-full h-14 mt-3 rounded-[14px] text-[15px] disabled:opacity-50"
        >
          {isSaving ? 'שומר...' : 'שמור'}
        </button>
      </div>

      {/* ── Spreadsheet ── */}
      <div className="px-4 mt-4 pb-6">
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '60vh' }} dir="rtl">
            <table className="border-collapse text-xs" style={{ minWidth: '100%' }}>
              <thead>
                <tr className="bg-primary text-white sticky top-0 z-[3]">
                  <th className="w-9 px-1.5 py-2 border-l border-white/10 text-[10px] text-white/50 font-normal sticky right-0 bg-primary z-[4]">
                    #
                  </th>
                  <th className="min-w-[64px] px-2.5 py-2 border-l border-white/10 font-bold text-[11px] text-white/90 sticky right-9 bg-primary z-[4]">
                    שעה
                  </th>
                  {cols.map((col) => (
                    <th key={col} className="min-w-[140px] p-0 border-l border-white/10">
                      <div className="flex items-center">
                        <input
                          defaultValue={col}
                          onBlur={(event) => handleColumnRenameBlur(col, event.currentTarget.value, event.currentTarget)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                          }}
                          className="flex-1 min-w-0 bg-transparent border-none outline-none text-white font-bold text-[11px] px-1.5 py-2 text-center"
                        />
                        <button
                          onClick={() => handleRemoveColumn(col)}
                          className="text-white/50 active:text-danger px-1.5 shrink-0"
                          aria-label={`מחק תפקיד ${col}`}
                        >
                          ✕
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="w-10 p-1.5">
                    <button
                      onClick={handleAddColumn}
                      className="border border-dashed border-white/20 text-white/70 rounded px-2 py-0.5 text-sm leading-none"
                      aria-label="הוסף תפקיד"
                    >
                      +
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const stripeBg = ri % 2 === 0 ? 'bg-white' : 'bg-background'

                  return (
                    <tr key={row.time} className={stripeBg}>
                      <td className={`text-center text-[10px] text-text-muted border-l border-b border-border sticky right-0 z-[2] ${stripeBg}`}>
                        {ri + 1}
                      </td>
                      <td className="border-l-2 border-primary/30 border-b border-border sticky right-9 z-[2] bg-primary-light">
                        <div className="text-center font-extrabold text-primary py-1.5 tabular-nums">{row.time}</div>
                      </td>
                      {cols.map((col, ci) => (
                        <td key={col} className="border-l border-b border-border p-0">
                          <input
                            ref={(element) => {
                              cellInputRefs.current[`${ri}-${ci}`] = element
                            }}
                            value={row.cells[col] ?? ''}
                            onChange={(event) => handleUpdateCell(row.time, col, event.target.value)}
                            onKeyDown={(event) => handleCellKeyDown(event, ri, ci)}
                            placeholder="—"
                            className="w-full min-w-[140px] px-2 py-1.5 border-none outline-none bg-transparent text-xs focus:bg-yellow-50"
                          />
                        </td>
                      ))}
                      <td className="text-center p-1 border-b border-border">
                        <button
                          onClick={() => handleRemoveTimeRow(row.time)}
                          className="text-text-muted active:text-danger px-1"
                          aria-label={`מחק שורת ${row.time}`}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td colSpan={cols.length + 3} className="p-2">
                    <button
                      onClick={handleAddTimeRow}
                      className="flex items-center gap-1 text-xs text-text-secondary border border-dashed border-border rounded px-3 py-1.5"
                    >
                      + הוסף שורה
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean). (Not routed yet — Task 9 — so there's nothing to visually verify until then.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/ShiftTemplateEditorPage.tsx
git commit -m "$(cat <<'EOF'
Add ShiftTemplateEditorPage (spreadsheet editor, not yet routed)

Reuses the same pure column/row/cell helper functions
RosterEditorPage's spreadsheet already uses (src/lib/rosterEditorUtils.ts)
— no logic duplicated, only the table JSX is new. Unlike
RosterEditorPage there's no draft/publish state and no delete action:
templates don't have a published/draft concept, and there's always
exactly one row per shift_id, so this page is a single "שמור" action
against an always-existing row.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire the routes

**Files:**
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: `ShiftTemplatesPage` (Task 7), `ShiftTemplateEditorPage` (Task 8).

- [ ] **Step 1: Add the imports**

Add these two import lines to `src/app/router.tsx`, keeping the existing alphabetical-by-path grouping style already in the file (insert near the other page imports):

```ts
import { ShiftTemplateEditorPage } from '../pages/ShiftTemplateEditorPage'
import { ShiftTemplatesPage } from '../pages/ShiftTemplatesPage'
```

- [ ] **Step 2: Add the routes under `AdminRoute`**

Inside the existing `<Route element={<AdminRoute />}>` block (currently containing `/admin`, `/roster-editor`, `/users`), add two more routes:

```tsx
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPanelPage />} />
            <Route path="/roster-editor" element={<RosterEditorPage />} />
            <Route path="/users" element={<UserManagementPage />} />
            <Route path="/shift-templates" element={<ShiftTemplatesListOrEditor />} />
          </Route>
```

Then add this small router component near the bottom of the file, next to `LoginRoute` (it picks list vs. editor based on the `?shiftId=` query param, matching Task 8's own read of that param):

```tsx
function ShiftTemplatesListOrEditor() {
  const [searchParams] = useSearchParams()
  return searchParams.get('shiftId') ? <ShiftTemplateEditorPage /> : <ShiftTemplatesPage />
}
```

Add `useSearchParams` to the existing `react-router-dom` import at the top of the file (currently `import { Navigate, Route, Routes } from 'react-router-dom'`):

```ts
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Visual verification**

Using the Browser pane, log in as a manager:
1. Navigate to `/admin`, click "תבניות משמרת" — confirm the list of 5 templates renders.
2. Click one of the cards — confirm the editor opens with that shift's title/subtitle and its actual saved grid content (compare a couple of cells against Task 1's seed data).
3. Edit a cell's text, click "שמור" — confirm it navigates back to the list, and re-opening the same template shows the edited value persisted.
4. Add a new role (column) via the `+` button, add a new time row via "+ הוסף שורה" — confirm both appear correctly and are saveable.
5. Log in as a non-manager (אחמ"ש or מאבטח) and confirm navigating directly to `/shift-templates` redirects away (same `AdminRoute` behavior as `/admin`).
6. Resize to `mobile` (375×812) and confirm both the list and editor screens render correctly at that width (this app is mobile-first; nothing in this feature should break there).

- [ ] **Step 5: Commit**

```bash
git add src/app/router.tsx
git commit -m "$(cat <<'EOF'
Route /shift-templates to the new list/editor screens

Query-param-driven, same pattern as /roster-editor's ?id= — no shiftId
shows the list (ShiftTemplatesPage), a shiftId shows the editor
(ShiftTemplateEditorPage). Manager-only via the existing AdminRoute
guard, same as every other admin screen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Delete `defaultRosterTemplates.ts` and final verification

**Files:**
- Delete: `src/lib/defaultRosterTemplates.ts`

**Interfaces:** None — this is cleanup once nothing imports it.

- [ ] **Step 1: Confirm nothing still imports it**

Run: `grep -rn "defaultRosterTemplates" src/`
Expected: no output. (Tasks 4, 5, 6 removed the only three call sites. If this returns anything, stop and check which task's removal was incomplete before proceeding.)

- [ ] **Step 2: Delete the file**

```bash
git rm src/lib/defaultRosterTemplates.ts
```

- [ ] **Step 3: Full typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Full regression pass**

Using the Browser pane, log in as a manager and walk through every route that touched shift/template data in this plan, confirming nothing regressed end-to-end:
- `/shift-live` — shift label text correct for the currently active category.
- `/shift-setup` — unaffected by this whole plan (never touched templates), but load it anyway and confirm the shift-variant picker cards still show correct labels (they read `shifts.ts` directly, already did before this plan).
- `/admin` — board list correct, "לוז חדש" flow still creates a board with correct seeded content, "תבניות משמרת" button present.
- `/roster-editor?id=...` — an existing board's title/subtitle correct.
- `/shift-templates` and `/shift-templates?shiftId=morning_6` (and at least one other shift) — list and editor both correct.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Remove defaultRosterTemplates.ts — shift_templates table is now the source

All three call sites (RosterEditorPage, ShiftLivePage, AdminPanelPage)
were migrated off it in earlier commits. Confirmed via grep that
nothing in src/ still imports it before deleting.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
