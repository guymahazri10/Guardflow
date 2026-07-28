# Shift template editing screen

## Problem

The five shift templates (`morning_6`, `morning_5`, `afternoon_3`, `afternoon_4`,
`night`) that seed a new roster board's schedule content live as a hardcoded
array in `src/lib/defaultRosterTemplates.ts`. Fixing a mistake in one (a wrong
task, a missing role for a time slot) currently requires a code change and a
deploy. The goal is a manager-only screen where this content can be edited
directly from the app.

## Scope

- **Editable:** each template's schedule grid only — the roles (columns), the
  half-hour time blocks (rows), and the task text in each cell (`cols` /
  `rows` in the same shape `roster_boards` already uses).
- **Not editable here, and not touched by this feature at all:** `shift_id`,
  display label, sub-label, hours range, or category. Those stay owned by
  `src/constants/shifts.ts`, exactly as today. Editing them here would create
  a second source of truth for the same data — the same class of bug already
  fixed once this session for position colors drifting between two files.
- **No create, no delete.** There are always exactly five templates, one per
  existing `shift_id`. This screen edits their content; it does not manage
  which shift types exist. (Explicitly decided over full CRUD — the app's
  shift categories/hours/labels are hardcoded in a separate, unrelated file,
  and making shift types themselves manageable would be a much larger,
  separate project.)

## Design

### Data model

New Supabase table `shift_templates`:

```sql
create table public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  shift_id text not null unique,
  cols jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  notes text,
  updated_at timestamptz not null default now()
);
```

No `label`/`sub_label`/`hours`/`is_overnight`/`icon` columns — per the scope
decision above, those stay in `shifts.ts`. `cols`/`rows` are exactly the
`string[]` / `{ time, cells: Record<string,string> }[]` shape `roster_boards`
already uses — no format translation needed anywhere in this feature.

A migration creates the table and seeds it with the five templates' current
real content (verbatim data from `defaultRosterTemplates.ts`'s `positions`
maps, pivoted once into the row-major shape by the migration itself — not at
runtime). After the migration lands and is verified, `defaultRosterTemplates.ts`
is deleted; the database becomes the single source of truth for template
content.

### Existing code affected

Three files currently call the synchronous, in-memory
`findDefaultRosterTemplateByShiftId`:

- **`RosterEditorPage.tsx`** — uses it today for both display (title/subtitle,
  which move to reading `shifts.ts` directly instead — see Scope) and nothing
  else; it doesn't use the template for editing (it edits an existing
  `roster_boards` row, not a template).
- **`ShiftLivePage.tsx`** — display only, same fix (read from `shifts.ts`).
- **`AdminPanelPage.tsx`** — uses the template as the seed data
  (`cols`/`rows`/`notes`) when creating a new `roster_boards` row from a
  picked shift. This becomes an async read via the new data hook instead of a
  synchronous module-level lookup.

All three move to a new `useShiftTemplates()` React Query hook (fetches all
five rows once; consistent with every other data access in this app — no new
patterns introduced).

### Editing screen

Two routes, mirroring the existing `AdminPanelPage` (list) /
`RosterEditorPage` (editor via `?id=`) pattern exactly:

- **`/shift-templates`** — list of the five templates as cards (same card
  style as `AdminPanelPage`'s board list), each showing its `shifts.ts`
  label/hours (read-only display) and a way into the editor.
- **`/shift-templates?id=X`** — the editor. The spreadsheet itself (columns =
  roles, rows = time blocks, Tab/Enter cell navigation, add/remove
  column/row, inline column rename) reuses the pure helper functions already
  in `src/lib/rosterEditorUtils.ts` (`addColumn`, `removeColumn`,
  `addTimeRow`, `removeTimeRow`, `renameColumn`, `updateCell`,
  `ensureRowsHaveAllColumns`) as-is — no logic is rewritten. The table JSX
  itself is new (structurally similar to `RosterEditorPage`'s, since that
  page's markup is tightly coupled to its own local state and mutation
  hooks — extracting a fully generic shared component isn't worth the risk
  for one additional consumer right now).

No draft/publish state (that concept belongs to `roster_boards`, not
templates) — a single "שמור" (save) action that upserts the row. No delete
action anywhere in this screen, per Scope.

### Access control

Both routes sit under the existing `AdminRoute` guard (`isAdmin` from
`AuthContext`) — same as every other manager-only screen. A "תבניות משמרת"
button on `AdminPanelPage`, next to the existing "לוז חדש" button, links to
`/shift-templates`.

### Testing

No test framework exists in this repo. Verification is `npx tsc -b` plus
manual browser checks: confirm all five templates list correctly, confirm
editing and saving a template's grid persists, confirm creating a new roster
board from `AdminPanelPage` still seeds correctly from the new DB-backed
template (the one path that actually depends on this data being correct,
not just display), and confirm a guard/commander (non-admin) is redirected
away from both new routes.
