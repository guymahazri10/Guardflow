# Dynamic shift variants — design spec

**Date:** 2026-07-30
**Status:** approved, pending implementation plan
**Branch:** `worktree-shift-templates` (extends the shift-templates work already merged into this branch)

## Problem

The previous phase of this branch moved shift *schedule content* (columns/rows/notes) out of a hardcoded file and into a `shift_templates` DB table, editable from `/shift-templates`. It deliberately kept the *catalog* of shift variants fixed: `src/constants/shifts.ts` still hardcodes exactly 5 `SHIFTS` entries (`morning_6`, `morning_5`, `afternoon_4`, `afternoon_3`, `night`), each belonging to one of 3 fixed time-of-day categories (`morning`/`afternoon`/`night`).

A manager now wants to add a new headcount variant (e.g. "בוקר 7 מאבטחים") without a code deploy, and to remove one they no longer need. The 3 time-of-day categories themselves stay fixed — `getActiveCategory()`'s clock-based boundaries (07:00/15:00/23:00) are not in scope for this change, and no category can be added or removed. Only the variants *within* a category become dynamic.

## Data model

New table `shift_types` (the variant catalog — parallel to how `shift_templates` already holds variant content):

```sql
create table public.shift_types (
  id text primary key,
  category text not null check (category in ('morning', 'afternoon', 'night')),
  guard_count int not null check (guard_count > 0),
  sort_order int not null,
  created_at timestamptz not null default now()
);
```

- `id` follows the existing convention: `${category}_${guard_count}` (e.g. `morning_7`), except the legacy `night` row keeps its historical bare `night` id (it predates the convention and nothing should rename it).
- Seeded with the 5 existing rows (same ids/categories/guard_counts as today's static `SHIFTS`), migrating this branch's existing hardcoded catalog the same way Task 1 migrated template content.
- `SHIFT_CATEGORIES` (label/color/hours per category) stays a static export in `shifts.ts` — categories are not dynamic, only variants are.
- RLS: `select` for any authenticated user (same as `shift_templates`); no direct `insert`/`update`/`delete` grant to `authenticated` — those go through the two RPCs below (`security definer`, so they can enforce the manager check plus cross-table atomicity that RLS alone can't express).

### Create RPC

```sql
create function public.create_shift_type_variant(
  p_category text,
  p_guard_count int,
  p_clone_from_shift_id text
) returns text -- new shift_id
```

- Validates caller is a manager (`public.get_my_role() = 'מנהל'`), `p_clone_from_shift_id` belongs to `p_category`, and no existing row already has this `(category, guard_count)` pair (friendly error otherwise, e.g. "כבר קיים וריאנט עם 7 מאבטחים בבוקר").
- Atomically inserts the new `shift_types` row and a `shift_templates` row whose `cols`/`rows` are copied from `p_clone_from_shift_id`'s current template, `notes` left null.
- Returns the new `shift_id` so the client can navigate straight to its editor.

### Delete RPC

```sql
create function public.delete_shift_type_variant(p_shift_id text) returns void
```

- Validates caller is a manager.
- Blocks (raises a friendly error) if any `roster_boards` row references `p_shift_id` — deleting a variant that already has a live/draft board would leave dangling references throughout `ShiftLivePage`/`RosterEditorPage`/`AdminPanelPage`. The manager must delete the board from `/admin` first.
- Otherwise atomically deletes the `shift_templates` row then the `shift_types` row.
- No distinction between the 5 seeded variants and manager-created ones — deletion works identically on any of them.

## Client-side refactor

`src/constants/shifts.ts` currently exports a static `SHIFTS: ShiftConfig[]` array plus helpers (`SHIFT_IDS_BY_CATEGORY`, `getShiftById`, `getShiftsByCategory`) built on top of it. These move to a new data/hook layer, mirroring `shiftTemplates.ts`/`useShiftTemplates.ts`:

- `src/lib/shiftTypes.ts` — `fetchShiftTypes()`, `createShiftTypeVariant()`, `deleteShiftTypeVariant()` (thin wrappers over the table/RPCs above).
- `src/hooks/useShiftTypes.ts` — `useShiftTypes()` (React Query, returns `ShiftConfig[]` built by combining each `shift_types` row with its category's static color/emoji/hours and the existing label-formatting convention), `useCreateShiftTypeVariant()`, `useDeleteShiftTypeVariant()`.
- `shifts.ts` keeps: `ShiftCategory` type, `SHIFT_CATEGORIES`, `getActiveCategory()`, and the pure label helpers (`getShiftShortLabel`, `getShiftHoursLabel`, `getShiftFullTitle`) — these already take a `ShiftConfig` argument and don't change signature, they just now receive DB-sourced objects instead of static ones.
- `getShiftById`/`getShiftsByCategory`/`SHIFT_IDS_BY_CATEGORY` are removed as static exports; equivalent lookups become derived from `useShiftTypes()`'s result inside each consumer (or via small selector helpers colocated with the hook, e.g. `useShiftTypes()` also returning a `Map`/by-category grouping alongside the flat list — implementation detail for the plan, not the spec).

**Every current static consumer becomes async** and needs a loading/error branch (most already have this pattern for `shift_templates` queries, e.g. `ShiftTemplateEditorPage`'s `templateQuery.isLoading` branch):

- `src/hooks/useActiveBoard.ts` — currently synchronously reads `SHIFT_IDS_BY_CATEGORY[category]`; needs the variant list for the active category before it can query `roster_boards`.
- `src/pages/ShiftSetupPage.tsx` — variant cards per category.
- `src/pages/ShiftLivePage.tsx` — `getShiftById` for the active board's label.
- `src/pages/RosterEditorPage.tsx` — `getShiftById` for title/subtitle.
- `src/pages/AdminPanelPage.tsx` — the full `SHIFTS` list for board cards + the picker sheet; also gains the create/delete UI (below).
- `src/pages/ShiftTemplatesPage.tsx` — the full `SHIFTS` list; gains the create/delete UI.
- `src/pages/ShiftTemplateEditorPage.tsx` — `getShiftById` for the header.

## New UI (on `/shift-templates` only)

- **"+ הוסף וריאנט"** button in the list header. Opens a small form: category select, guard-count number input, "שכפל מ" dropdown scoped to existing variants of the selected category (required). On submit, calls the create RPC via `useCreateShiftTypeVariant()`, then navigates straight to `/shift-templates?shiftId=<new id>` so the manager can immediately review/adjust the cloned content.
- **🗑 delete** action per card, manager-only, with a confirm dialog. Calls the delete RPC; on the "has existing roster_boards" rejection, shows that message inline instead of a generic error.
- `AdminPanelPage` needs no new UI — it already iterates over "all shifts" generically, so once it reads from `useShiftTypes()` a new variant just appears in its board-picker sheet like any other, with no special-casing.

## Out of scope (explicitly)

- Adding/removing a 4th time-of-day category — categories stay the fixed 3, unrelated to this change.
- Renaming an existing variant's guard count/label after creation.
- Any change to `getActiveCategory()`'s clock-based boundaries.

## Testing plan

- `npx tsc -b` clean throughout.
- Manual pass in the Browser pane, manager login: create a variant (e.g. a 3rd morning option), confirm it appears in `/shift-templates`, `/admin`'s picker, and `/shift-setup`'s morning tab; edit and save its cloned content; create a roster board for it via `/admin`; confirm deleting it while a board exists is blocked with the friendly error; delete the board, then delete the variant successfully; confirm it disappears everywhere.
- Confirm the 5 original (seeded) variants remain fully functional and are deletable/recreatable with no special-casing versus a manager-created one.
