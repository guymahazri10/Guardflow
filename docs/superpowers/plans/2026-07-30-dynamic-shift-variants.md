# Dynamic Shift Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager create and delete headcount variants of a shift (e.g. add "בוקר 7 מאבטחים") from the app itself, with no code deploy, while keeping the 3 time-of-day categories (morning/afternoon/night) fixed.

**Architecture:** The catalog of shift variants — currently a hardcoded `SHIFTS` array in `src/constants/shifts.ts` — moves into a new `shift_types` Postgres table (parallel to how `shift_templates` already holds each variant's schedule content). Create/delete go through two `security definer` RPCs that keep `shift_types` and `shift_templates` in lockstep atomically and enforce the manager-only check server-side. Every page that currently imports the static `SHIFTS`/`SHIFT_IDS_BY_CATEGORY`/`getShiftById`/`getShiftsByCategory` exports switches to a new `useShiftTypes()` React Query hook (mirroring the existing `useShiftTemplates()` pattern).

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + RLS + RPCs), TanStack React Query, Tailwind.

## Global Constraints

- Categories (`morning`/`afternoon`/`night`) and their clock boundaries (`getActiveCategory`) are fixed — never touch that logic in this plan.
- The 5 existing seeded variants get no special treatment versus manager-created ones — same create/delete code path.
- `npx tsc -b` must be clean after every task.
- Manager-only enforcement lives in the RPCs (server-side); the client never needs its own extra role check because every page that reaches this UI is already behind `AdminRoute` (manager-only).

---

### Task 1: `shift_types` table + create/delete RPCs

**Files:**
- Create: `supabase/phase19_shift_types.sql`

**Interfaces:**
- Produces: table `public.shift_types(id text primary key, category text, guard_count int, sort_order int, created_at timestamptz)`; RPCs `public.create_shift_type_variant(p_category text, p_guard_count int, p_clone_from_shift_id text) returns text` and `public.delete_shift_type_variant(p_shift_id text) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- GuardFlow Phase 19 — shift_types table (dynamic shift-variant catalog)
--
-- Moves the catalog of shift variants (previously the hardcoded SHIFTS array
-- in src/constants/shifts.ts) into the database, so a manager can add or
-- remove a headcount variant within an existing time-of-day category
-- (morning/afternoon/night) without a code deploy. The 3 categories
-- themselves stay fixed — this table only holds variants *within* them.
--
-- Each row here has exactly one corresponding shift_templates row (its
-- schedule content) and, once a manager creates a roster_boards row for it,
-- that too. create_shift_type_variant/delete_shift_type_variant below keep
-- shift_types and shift_templates in lockstep atomically.

create table public.shift_types (
  id text primary key,
  category text not null check (category in ('morning', 'afternoon', 'night')),
  guard_count int not null check (guard_count > 0),
  sort_order int not null,
  created_at timestamptz not null default now()
);

comment on table public.shift_types is 'Catalog of shift-variant ids within the 3 fixed time-of-day categories. Each row has exactly one shift_templates row for its schedule content.';

alter table public.shift_types enable row level security;

-- Any authenticated user may read the catalog (needed by every page that
-- lists or looks up shifts) — same as shift_templates' own select policy.
create policy "shift_types select authenticated"
  on public.shift_types
  for select
  to authenticated
  using (true);

-- No insert/update/delete grant for `authenticated` — those only happen
-- through the two security-definer RPCs below, which keep shift_types and
-- shift_templates consistent and enforce the manager check server-side
-- (mirroring set_user_app_role's pattern in phase6).
revoke all on public.shift_types from anon, authenticated;
grant select on public.shift_types to authenticated;

insert into public.shift_types (id, category, guard_count, sort_order) values
('morning_6', 'morning', 6, 1),
('morning_5', 'morning', 5, 2),
('afternoon_4', 'afternoon', 4, 3),
('afternoon_3', 'afternoon', 3, 4),
('night', 'night', 2, 5);

create function public.create_shift_type_variant(
  p_category text,
  p_guard_count int,
  p_clone_from_shift_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id text;
  source_category text;
  source_cols jsonb;
  source_rows jsonb;
begin
  if public.get_my_role() <> 'מנהל' then
    raise exception 'Not authorized to create shift variants' using errcode = '42501';
  end if;

  if p_category not in ('morning', 'afternoon', 'night') then
    raise exception 'Invalid category value' using errcode = '22023';
  end if;

  if p_guard_count <= 0 then
    raise exception 'Guard count must be a positive integer' using errcode = '22023';
  end if;

  select category into source_category from public.shift_types where id = p_clone_from_shift_id;

  if source_category is null then
    raise exception 'Shift to clone from was not found' using errcode = 'P0002';
  end if;

  if source_category <> p_category then
    raise exception 'Shift to clone from must belong to the same category' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.shift_types
    where category = p_category and guard_count = p_guard_count
  ) then
    raise exception 'כבר קיים וריאנט עם % מאבטחים בקטגוריה זו', p_guard_count using errcode = '23505';
  end if;

  select cols, rows into source_cols, source_rows
  from public.shift_templates
  where shift_id = p_clone_from_shift_id;

  new_id := p_category || '_' || p_guard_count;

  insert into public.shift_types (id, category, guard_count, sort_order)
  values (
    new_id,
    p_category,
    p_guard_count,
    coalesce((select max(sort_order) from public.shift_types), 0) + 1
  );

  insert into public.shift_templates (shift_id, cols, rows, notes)
  values (new_id, source_cols, source_rows, null);

  return new_id;
end;
$$;

revoke all on function public.create_shift_type_variant(text, int, text) from public;
grant execute on function public.create_shift_type_variant(text, int, text) to authenticated;

create function public.delete_shift_type_variant(p_shift_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_my_role() <> 'מנהל' then
    raise exception 'Not authorized to delete shift variants' using errcode = '42501';
  end if;

  if not exists (select 1 from public.shift_types where id = p_shift_id) then
    raise exception 'Shift variant not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.roster_boards where shift_id = p_shift_id) then
    raise exception 'לא ניתן למחוק וריאנט שיש לו לו״ז קיים — יש למחוק קודם את הלו״ז מ-/admin' using errcode = '23503';
  end if;

  delete from public.shift_templates where shift_id = p_shift_id;
  delete from public.shift_types where id = p_shift_id;
end;
$$;

revoke all on function public.delete_shift_type_variant(text) from public;
grant execute on function public.delete_shift_type_variant(text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply the SQL above to the project's Supabase database (via your Supabase MCP tool's `apply_migration`, name it `shift_types_table`, or paste it into the Supabase SQL editor).

- [ ] **Step 3: Verify**

Run this query (via the same tool, or SQL editor):

```sql
select id, category, guard_count, sort_order from public.shift_types order by sort_order;
```

Expected: exactly 5 rows — `morning_6`/`morning`/6/1, `morning_5`/`morning`/5/2, `afternoon_4`/`afternoon`/4/3, `afternoon_3`/`afternoon`/3/4, `night`/`night`/2/5.

Then confirm both functions exist:

```sql
select proname from pg_proc where proname in ('create_shift_type_variant', 'delete_shift_type_variant');
```

Expected: both names returned. (Full end-to-end exercise of the RPCs — as a real manager session with `auth.uid()` — happens in Task 10/11's live browser verification, once the client UI calling them exists.)

- [ ] **Step 4: Commit**

```bash
git add supabase/phase19_shift_types.sql
git commit -m "$(cat <<'EOF'
Add shift_types table + create/delete RPCs for dynamic shift variants

Seeds the 5 existing hardcoded variants (same ids/categories/guard
counts as the current static SHIFTS array in shifts.ts). The 3
time-of-day categories stay fixed; only the variants within them
become dynamic. create_shift_type_variant/delete_shift_type_variant
are security-definer, manager-only, and keep this table and
shift_templates in lockstep atomically — mirroring set_user_app_role's
existing pattern (phase6) for the manager check.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Data layer — `shiftTypes.ts` + `useShiftTypes.ts` + `shifts.ts` additions

**Files:**
- Create: `src/lib/shiftTypes.ts`
- Create: `src/hooks/useShiftTypes.ts`
- Modify: `src/constants/shifts.ts`

**Interfaces:**
- Consumes: `supabase` client from `src/lib/supabase.ts`; `shiftTemplateKeys` from `src/hooks/useShiftTemplates.ts` (already exists).
- Produces: `fetchShiftTypes(): Promise<ShiftTypeRow[]>`, `createShiftTypeVariant(input: CreateShiftTypeVariantInput): Promise<string>`, `deleteShiftTypeVariant(shiftId: string): Promise<void>` from `shiftTypes.ts`; `useShiftTypes()` (returns `UseQueryResult<ShiftConfig[]>`), `useCreateShiftTypeVariant()`, `useDeleteShiftTypeVariant()` from `useShiftTypes.ts`; `buildShiftConfig(row): ShiftConfig` from `shifts.ts`.

This task is purely additive — it doesn't touch any of the 7 existing consumer files, so `SHIFTS`/`SHIFT_IDS_BY_CATEGORY`/`getShiftById`/`getShiftsByCategory` stay in `shifts.ts` for now (removed in Task 9, once nothing references them).

- [ ] **Step 1: Update `src/constants/shifts.ts`**

Replace the whole file with:

```ts
export type ShiftCategory = 'morning' | 'afternoon' | 'night';

export interface ShiftConfig {
  id: string;
  label: string;
  category: ShiftCategory;
  startHour: number;
  endHour: number;
}

export const SHIFT_CATEGORIES: Record<ShiftCategory, { label: string; hours: string; startHour: number; endHour: number }> = {
  morning: { label: 'בוקר', hours: '07:00–15:00', startHour: 7, endHour: 15 },
  afternoon: { label: 'צהריים', hours: '15:00–23:00', startHour: 15, endHour: 23 },
  night: { label: 'לילה', hours: '23:00–07:00', startHour: 23, endHour: 7 },
};

export const SHIFTS: ShiftConfig[] = [
  { id: 'morning_6', label: 'בוקר 6 מאבטחים', category: 'morning', startHour: 7, endHour: 15 },
  { id: 'morning_5', label: 'בוקר 5 מאבטחים', category: 'morning', startHour: 7, endHour: 15 },
  { id: 'afternoon_4', label: 'צהריים 4 מאבטחים', category: 'afternoon', startHour: 15, endHour: 23 },
  { id: 'afternoon_3', label: 'צהריים 3 מאבטחים', category: 'afternoon', startHour: 15, endHour: 23 },
  { id: 'night', label: 'לילה 2 מאבטחים', category: 'night', startHour: 23, endHour: 7 },
];

export const SHIFT_IDS_BY_CATEGORY: Record<ShiftCategory, string[]> = {
  morning: ['morning_6', 'morning_5'],
  afternoon: ['afternoon_4', 'afternoon_3'],
  night: ['night'],
};

export function getActiveCategory(hour?: number): ShiftCategory {
  const h = hour ?? new Date().getHours();
  if (h >= 7 && h < 15) return 'morning';
  if (h >= 15 && h < 23) return 'afternoon';
  return 'night';
}

export function getShiftById(id: string): ShiftConfig | undefined {
  return SHIFTS.find((s) => s.id === id);
}

export function getShiftsByCategory(category: ShiftCategory): ShiftConfig[] {
  return SHIFTS.filter((s) => s.category === category);
}

/** Builds a ShiftConfig from a shift_types row (see useShiftTypes()) — fills
 *  in the derived label and the category's fixed hour boundaries. Once every
 *  page reads from useShiftTypes() instead of the static SHIFTS array
 *  (Task 9), this becomes the only way ShiftConfig objects get built. */
export function buildShiftConfig(row: { id: string; category: ShiftCategory; guard_count: number }): ShiftConfig {
  const catConfig = SHIFT_CATEGORIES[row.category];
  return {
    id: row.id,
    category: row.category,
    label: `${catConfig.label} ${row.guard_count} מאבטחים`,
    startHour: catConfig.startHour,
    endHour: catConfig.endHour,
  };
}

/** Strip the category name from a shift's label: "בוקר 6 מאבטחים" → "6 מאבטחים" */
export function getShiftShortLabel(shift: ShiftConfig): string {
  const cat = SHIFT_CATEGORIES[shift.category].label;
  const stripped = shift.label.replace(cat, '').trim();
  return stripped || shift.label;
}

/** "07:00–15:00" from startHour / endHour */
export function getShiftHoursLabel(shift: ShiftConfig): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(shift.startHour)}:00–${p(shift.endHour)}:00`;
}

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

(This drops the unused `color`/`emoji` fields that existed on `ShiftConfig`/`SHIFT_CATEGORIES`/`SHIFTS` before — confirmed via `grep -rn "\.emoji\|\.color" src/` that nothing reads them. Everything else is unchanged in behavior; `buildShiftConfig` is new and not yet called anywhere.)

- [ ] **Step 2: Create `src/lib/shiftTypes.ts`**

```ts
import { supabase } from './supabase'
import type { ShiftCategory } from '../constants/shifts'

export type ShiftTypeRow = {
  id: string
  category: ShiftCategory
  guard_count: number
  sort_order: number
}

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

export async function fetchShiftTypes(): Promise<ShiftTypeRow[]> {
  const { data, error } = await supabase
    .from('shift_types')
    .select('id, category, guard_count, sort_order')
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift types', error))
  }

  return (data ?? []) as ShiftTypeRow[]
}

export type CreateShiftTypeVariantInput = {
  category: ShiftCategory
  guardCount: number
  cloneFromShiftId: string
}

export async function createShiftTypeVariant(input: CreateShiftTypeVariantInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_shift_type_variant', {
    p_category: input.category,
    p_guard_count: input.guardCount,
    p_clone_from_shift_id: input.cloneFromShiftId,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to create shift variant', error))
  }

  return data as string
}

export async function deleteShiftTypeVariant(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_shift_type_variant', { p_shift_id: shiftId })

  if (error) {
    throw new Error(getErrorMessage('Failed to delete shift variant', error))
  }
}
```

- [ ] **Step 3: Create `src/hooks/useShiftTypes.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createShiftTypeVariant,
  deleteShiftTypeVariant,
  fetchShiftTypes,
  type CreateShiftTypeVariantInput,
} from '../lib/shiftTypes'
import { buildShiftConfig, type ShiftConfig } from '../constants/shifts'
import { shiftTemplateKeys } from './useShiftTemplates'

export const shiftTypeKeys = {
  all: ['shiftTypes'] as const,
  list: () => [...shiftTypeKeys.all, 'list'] as const,
}

export function useShiftTypes() {
  return useQuery({
    queryKey: shiftTypeKeys.list(),
    queryFn: fetchShiftTypes,
    select: (rows): ShiftConfig[] => rows.map(buildShiftConfig),
  })
}

export function useCreateShiftTypeVariant() {
  const queryClient = useQueryClient()

  return useMutation<string, Error, CreateShiftTypeVariantInput>({
    mutationFn: createShiftTypeVariant,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftTypeKeys.list() }),
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.list() }),
      ])
    },
  })
}

export function useDeleteShiftTypeVariant() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: deleteShiftTypeVariant,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftTypeKeys.list() }),
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.list() }),
      ])
    },
  })
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean) — nothing yet imports the two new files, and `shifts.ts`'s public API only gained `buildShiftConfig`, so no existing consumer breaks.

- [ ] **Step 5: Commit**

```bash
git add src/constants/shifts.ts src/lib/shiftTypes.ts src/hooks/useShiftTypes.ts
git commit -m "$(cat <<'EOF'
Add shift_types data access and React Query hooks

Purely additive — shifts.ts keeps its existing static SHIFTS array and
helpers for now (removed in a later task once nothing references
them), this just adds the new DB-backed path alongside it. Drops the
color/emoji fields from ShiftConfig/SHIFT_CATEGORIES/SHIFTS: grep
confirms nothing in src/ ever reads them.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migrate `useActiveBoard` + `ShiftLivePage` to `useShiftTypes()`

**Files:**
- Modify: `src/hooks/useActiveBoard.ts`
- Modify: `src/pages/ShiftLivePage.tsx`

**Interfaces:**
- Consumes: `useShiftTypes` from `src/hooks/useShiftTypes.ts` (Task 2).

- [ ] **Step 1: Rewrite `src/hooks/useActiveBoard.ts`**

Replace the whole file with:

```ts
import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getActiveCategory, type ShiftCategory } from '../constants/shifts';
import { useShiftTypes } from './useShiftTypes';
import type { RosterBoard } from '../lib/rosterBoards';

interface ActiveBoardResult {
  board: RosterBoard | null;
  loading: boolean;
  error: string | null;
  category: ShiftCategory;
  refetch: () => void;
}

let instanceCounter = 0;

export function useActiveBoard(): ActiveBoardResult {
  const shiftTypesQuery = useShiftTypes();
  const [board, setBoard] = useState<RosterBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Supabase returns the same channel object for a topic that's already
  // subscribed, so concurrent useActiveBoard() callers (e.g. ShiftLivePage
  // and PositionChangeNotifier mounted at the same time) need distinct
  // topic names or the second .subscribe() collides with the first.
  const instanceIdRef = useRef<number | undefined>(undefined);
  if (instanceIdRef.current === undefined) {
    instanceCounter += 1;
    instanceIdRef.current = instanceCounter;
  }

  const category = getActiveCategory();
  const shiftIds = useMemo(
    () => (shiftTypesQuery.data ?? []).filter((s) => s.category === category).map((s) => s.id),
    [shiftTypesQuery.data, category],
  );

  useEffect(() => {
    if (shiftTypesQuery.isLoading) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('roster_boards')
        .select('*')
        .eq('published', true)
        .in('shift_id', shiftIds)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (err) setError(err.message);
      else setBoard(data ?? null);
      setLoading(false);
    }

    load();

    const channel = supabase
      .channel(`roster-board-${instanceIdRef.current}-${category}-${tick}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_boards' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as { id: string }).id;
          setBoard((prev) => (prev?.id === deletedId ? null : prev));
          return;
        }
        const updated = payload.new as RosterBoard;
        if (!shiftIds.includes(updated.shift_id)) return;
        if (updated.published) {
          setBoard(updated);
        } else {
          setBoard((prev) => (prev?.id === updated.id ? null : prev));
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [category, tick, shiftTypesQuery.isLoading, shiftIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    board,
    loading: loading || shiftTypesQuery.isLoading,
    error: error ?? (shiftTypesQuery.isError ? 'טעינת סוגי המשמרות נכשלה.' : null),
    category,
    refetch: () => setTick((t) => t + 1),
  };
}
```

- [ ] **Step 2: Update `src/pages/ShiftLivePage.tsx`**

Replace this import line:

```ts
import { SHIFT_CATEGORIES, getShiftById, getShiftFullTitle, getShiftHoursLabel } from '../constants/shifts'
```

with:

```ts
import { SHIFT_CATEGORIES, getShiftFullTitle, getShiftHoursLabel } from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
```

Then replace this line (inside `ShiftLivePage`, right after `const { board, loading, error, category, refetch } = useActiveBoard()`):

```ts
  const shift = board ? getShiftById(board.shift_id) : undefined
```

with:

```ts
  const shiftTypesQuery = useShiftTypes()
  const shift = board ? shiftTypesQuery.data?.find((s) => s.id === board.shift_id) : undefined
```

(`useShiftTypes()` is called again here even though `useActiveBoard` already calls it internally — React Query dedupes by query key, so this is a cache hit, not a second network request. No other line in this file changes: `shift` still flows into `getShiftFullTitle`/`getShiftHoursLabel` exactly as before, just possibly `undefined` for one extra render while the shared query is in flight, which the existing `shift ? ... : catConfig...` fallback already handles gracefully.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Visual verification**

Using the Browser pane, log in and open `/shift-live`. Confirm the shift label/hours text at the top is unchanged from before this task, for whichever category is currently active.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useActiveBoard.ts src/pages/ShiftLivePage.tsx
git commit -m "$(cat <<'EOF'
Migrate useActiveBoard and ShiftLivePage to useShiftTypes()

First consumers off the static SHIFTS/SHIFT_IDS_BY_CATEGORY exports.
useActiveBoard now waits for the shift-types query before it can
resolve which shift_ids belong to the active category, composing its
own loading/error state with the shift-types query's.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Migrate `RosterEditorPage` to `useShiftTypes()`

**Files:**
- Modify: `src/pages/RosterEditorPage.tsx`

**Interfaces:**
- Consumes: `useShiftTypes` from `src/hooks/useShiftTypes.ts` (Task 2).

- [ ] **Step 1: Update the import**

Replace:

```ts
import { SHIFT_CATEGORIES, getShiftById, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
```

with:

```ts
import { SHIFT_CATEGORIES, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
```

- [ ] **Step 2: Replace the shift lookup**

Inside the `RosterEditorPage` component, replace this line (currently right after `const board = rosterBoardQuery.data ?? null`):

```ts
  const shift = board ? getShiftById(board.shift_id) : undefined
```

with:

```ts
  const shiftTypesQuery = useShiftTypes()
  const shift = board ? shiftTypesQuery.data?.find((s) => s.id === board.shift_id) : undefined
```

Every downstream line (`title`, `subtitle`, `hours`, `typeLabel`) stays exactly as-is — they all read from `shift`, which keeps the same shape.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Visual verification**

Using the Browser pane, open `/admin`, pick an existing board, click "פתח לוז". Confirm the title/subtitle/type-label text at the top of `/roster-editor` is unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
git add src/pages/RosterEditorPage.tsx
git commit -m "$(cat <<'EOF'
Migrate RosterEditorPage to useShiftTypes()

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate `ShiftTemplateEditorPage` to `useShiftTypes()`

**Files:**
- Modify: `src/pages/ShiftTemplateEditorPage.tsx`

**Interfaces:**
- Consumes: `useShiftTypes` from `src/hooks/useShiftTypes.ts` (Task 2).

- [ ] **Step 1: Update the import**

Replace:

```ts
import { getShiftById, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
```

with:

```ts
import { getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
```

- [ ] **Step 2: Replace the shift lookup and add a loading branch**

Replace this line:

```ts
  const shift = shiftId ? getShiftById(shiftId) : undefined
```

with:

```ts
  const shiftTypesQuery = useShiftTypes()
  const shift = shiftId ? shiftTypesQuery.data?.find((s) => s.id === shiftId) : undefined
```

Then replace the existing loading-check block:

```tsx
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
```

with:

```tsx
  if (templateQuery.isLoading || shiftTypesQuery.isLoading) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">טוען תבנית...</div>
        </div>
      </div>
    )
  }
```

(This must come before the existing `if (!shiftId || !shift)` "missing shift" branch — check the current file: the loading branch is already ordered after the `!shiftId || !shift` branch, which would incorrectly show "חסר מזהה משמרת לעריכה" during the brief window before `shiftTypesQuery` resolves, since `shift` is `undefined` both while loading and when truly missing. Move the combined loading check above the `!shiftId || !shift` branch — i.e. the final order of the three guard blocks must be: (1) `if (!shiftId)` alone — drop `|| !shift` from this one, since a missing shift is now ambiguous with "still loading" and must wait for step 2; (2) the loading check above; (3) `if (!shift || templateQuery.isError || !template)` for the genuinely-not-found/error case, replacing the old `if (templateQuery.isError || !template)` block.)

Concretely, the three guard blocks should read, in this order:

```tsx
  if (!shiftId) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">חסר מזהה משמרת לעריכה.</div>
        </div>
      </div>
    )
  }

  if (templateQuery.isLoading || shiftTypesQuery.isLoading) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">טוען תבנית...</div>
        </div>
      </div>
    )
  }

  if (!shift || templateQuery.isError || !template) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">
            {templateQuery.isError || !shift ? 'טעינת התבנית נכשלה.' : 'התבנית לא נמצאה.'}
          </div>
        </div>
      </div>
    )
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Visual verification**

Using the Browser pane, open `/shift-templates?shiftId=morning_6`. Confirm the header title/subtitle and grid content render exactly as before this task.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ShiftTemplateEditorPage.tsx
git commit -m "$(cat <<'EOF'
Migrate ShiftTemplateEditorPage to useShiftTypes()

Reordered the guard blocks so "still loading shift types" no longer
gets misreported as "missing shift id" during the brief window before
the query resolves.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Migrate `ShiftSetupPage` to `useShiftTypes()`

**Files:**
- Modify: `src/pages/ShiftSetupPage.tsx`

**Interfaces:**
- Consumes: `useShiftTypes` from `src/hooks/useShiftTypes.ts` (Task 2).

- [ ] **Step 1: Update the import**

Replace:

```ts
import {
  getActiveCategory,
  getShiftHoursLabel,
  getShiftShortLabel,
  getShiftsByCategory,
  SHIFT_CATEGORIES,
  SHIFT_IDS_BY_CATEGORY,
  type ShiftCategory,
} from '../constants/shifts'
```

with:

```ts
import {
  getActiveCategory,
  getShiftHoursLabel,
  getShiftShortLabel,
  SHIFT_CATEGORIES,
  type ShiftCategory,
} from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
```

- [ ] **Step 2: Replace category/selection state**

Replace these two lines:

```ts
  const [category, setCategory] = useState<ShiftCategory>(() => getActiveCategory())
  const [selectedShiftId, setSelectedShiftId] = useState<string>(
    () => SHIFT_IDS_BY_CATEGORY[getActiveCategory()][0],
  )
```

with:

```ts
  const shiftTypesQuery = useShiftTypes()
  const allShifts = shiftTypesQuery.data ?? []

  const [category, setCategory] = useState<ShiftCategory>(() => getActiveCategory())
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)

  // Picks the first variant in the active category once shift types load —
  // can't do this synchronously anymore since the catalog is now async.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current || allShifts.length === 0) return
    const firstInCategory = allShifts.find((s) => s.category === category)
    if (firstInCategory) {
      setSelectedShiftId(firstInCategory.id)
      didInitRef.current = true
    }
  }, [allShifts, category])
```

- [ ] **Step 3: Replace `handleCategoryChange`**

Replace:

```ts
  function handleCategoryChange(cat: ShiftCategory) {
    setCategory(cat)
    setSelectedShiftId(SHIFT_IDS_BY_CATEGORY[cat][0])
  }
```

with:

```ts
  function handleCategoryChange(cat: ShiftCategory) {
    setCategory(cat)
    const firstInCategory = allShifts.find((s) => s.category === cat)
    setSelectedShiftId(firstInCategory?.id ?? null)
  }
```

- [ ] **Step 4: Replace the `shifts` derived value**

Replace:

```ts
  const shifts = getShiftsByCategory(category)
```

with:

```ts
  const shifts = allShifts.filter((s) => s.category === category)
```

- [ ] **Step 5: Add a loading state for the variant-cards grid**

Replace this whole block (from the `{/* Shift variant cards */}` comment down to the closing `</div>` right before the `{/* Guard name inputs */}` comment):

```tsx
        {/* Shift variant cards */}
        <div className={`grid gap-3 ${shifts.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {shifts.map((shift) => {
            const selected = shift.id === selectedShiftId
            return (
              <button
                key={shift.id}
                onClick={() => setSelectedShiftId(shift.id)}
                className={`card p-3.5 text-right transition-all active:scale-[0.98] ${
                  selected ? 'ring-2 ring-primary' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  {/* Checkmark circle */}
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      selected ? 'border-primary bg-primary' : 'border-border'
                    }`}
                  >
                    {selected && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path
                          d="M1.5 5l2.5 2.5 4.5-4.5"
                          stroke="white"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 text-right">
                    <p
                      className={`text-sm font-semibold leading-snug ${
                        selected ? 'text-primary' : 'text-text-primary'
                      }`}
                    >
                      {getShiftShortLabel(shift)}
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5 tabular-nums" dir="ltr">
                      {getShiftHoursLabel(shift)}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
```

with:

```tsx
        {/* Shift variant cards */}
        {shiftTypesQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((i) => (
              <div key={i} className="card p-3.5 h-[72px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className={`grid gap-3 ${shifts.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {shifts.map((shift) => {
              const selected = shift.id === selectedShiftId
              return (
                <button
                  key={shift.id}
                  onClick={() => setSelectedShiftId(shift.id)}
                  className={`card p-3.5 text-right transition-all active:scale-[0.98] ${
                    selected ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {/* Checkmark circle */}
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        selected ? 'border-primary bg-primary' : 'border-border'
                      }`}
                    >
                      {selected && (
                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M1.5 5l2.5 2.5 4.5-4.5"
                            stroke="white"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>

                    {/* Text */}
                    <div className="flex-1 text-right">
                      <p
                        className={`text-sm font-semibold leading-snug ${
                          selected ? 'text-primary' : 'text-text-primary'
                        }`}
                      >
                        {getShiftShortLabel(shift)}
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5 tabular-nums" dir="ltr">
                        {getShiftHoursLabel(shift)}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 7: Visual verification**

Using the Browser pane, open `/shift-setup`. Confirm: all 3 category tabs work, each shows its correct variant cards with correct labels/hours, selecting a variant loads its guard-name inputs, and saving still works.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ShiftSetupPage.tsx
git commit -m "$(cat <<'EOF'
Migrate ShiftSetupPage to useShiftTypes()

selectedShiftId's initial value can no longer be computed
synchronously (the catalog is now an async query), so it starts null
and a one-time effect picks the active category's first variant once
the query resolves.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migrate `AdminPanelPage` to `useShiftTypes()`

**Files:**
- Modify: `src/pages/AdminPanelPage.tsx`

**Interfaces:**
- Consumes: `useShiftTypes` from `src/hooks/useShiftTypes.ts` (Task 2).

- [ ] **Step 1: Update the import**

Replace:

```ts
import { SHIFTS, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel, type ShiftConfig } from '../constants/shifts'
```

with:

```ts
import { getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel, type ShiftConfig } from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
```

- [ ] **Step 2: Replace the module-level `SHIFT_DISPLAYS` constant with a per-render `useMemo`**

Delete this line (module-level, outside the component):

```ts
const SHIFT_DISPLAYS: ShiftDisplay[] = SHIFTS.map(buildShiftDisplay)
```

Inside the `AdminPanelPage` component, add this near the other hooks (after `const shiftTemplatesQuery = useShiftTemplates()`):

```ts
  const shiftTypesQuery = useShiftTypes()
  const shiftDisplays: ShiftDisplay[] = useMemo(
    () => (shiftTypesQuery.data ?? []).map(buildShiftDisplay),
    [shiftTypesQuery.data],
  )
```

Add `useMemo` to the existing `react` import at the top (currently `import { useMemo, useState } from 'react'` — already imports `useMemo`, no change needed there).

Then replace every remaining reference to `SHIFT_DISPLAYS` in the file (there are three: in `existingDisplays`, in `handlePickFromSheet`'s shift lookup — actually that one currently reads `SHIFTS.find(...)`, see step 3 — and in the picker sheet's `.map()`) with `shiftDisplays`:

```ts
  const existingDisplays = shiftDisplays.filter((display) => boardByShiftId.has(display.shift.id))
```

```ts
  const selectedDisplay = selectedShiftId
    ? (shiftDisplays.find((display) => display.shift.id === selectedShiftId) ?? null)
    : null
```

And in the JSX, replace:

```tsx
              {SHIFT_DISPLAYS.map(({ shift, title, subtitle }) => {
```

with:

```tsx
              {shiftDisplays.map(({ shift, title, subtitle }) => {
```

- [ ] **Step 3: Replace the `SHIFTS.find(...)` lookup in `handlePickFromSheet`**

Replace:

```ts
    const shift = SHIFTS.find((s) => s.id === shiftId)
```

with:

```ts
    const shift = shiftTypesQuery.data?.find((s) => s.id === shiftId)
```

- [ ] **Step 4: Extend the loading guards**

Replace this line in the picker sheet's row-rendering:

```ts
                const templatesLoading = shiftTemplatesQuery.isLoading
```

with:

```ts
                const templatesLoading = shiftTemplatesQuery.isLoading || shiftTypesQuery.isLoading
```

And replace the board-list loading check:

```tsx
        {rosterBoardsQuery.isLoading ? (
          <ListSkeleton />
        ) : existingDisplays.length === 0 ? (
```

with:

```tsx
        {rosterBoardsQuery.isLoading || shiftTypesQuery.isLoading ? (
          <ListSkeleton />
        ) : existingDisplays.length === 0 ? (
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 6: Visual verification**

Using the Browser pane, open `/admin`. Confirm the board list, the picker sheet (all 5 shift types with correct titles/subtitles/badges), and the "לוז חדש" creation flow all work exactly as before this task.

- [ ] **Step 7: Commit**

```bash
git add src/pages/AdminPanelPage.tsx
git commit -m "$(cat <<'EOF'
Migrate AdminPanelPage to useShiftTypes()

No new UI here — this page already iterates over "all shifts"
generically, so once a manager creates a new variant (added in a later
task) it will just appear in this board list and picker sheet like any
other, with no special-casing needed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Migrate `ShiftTemplatesPage` to `useShiftTypes()`

**Files:**
- Modify: `src/pages/ShiftTemplatesPage.tsx`

**Interfaces:**
- Consumes: `useShiftTypes` from `src/hooks/useShiftTypes.ts` (Task 2).

This task only swaps the data source — the create/delete UI comes in Tasks 10–11, after the now-dead static exports are removed in Task 9.

- [ ] **Step 1: Update the import**

Replace:

```ts
import { SHIFTS, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
```

with:

```ts
import { getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
```

- [ ] **Step 2: Replace `SHIFTS.map(...)` and extend the loading/error checks**

Inside the component, add near the top:

```ts
  const shiftTypesQuery = useShiftTypes()
```

Replace:

```tsx
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
```

with:

```tsx
      {(templatesQuery.isError || shiftTypesQuery.isError) && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          טעינת התבניות נכשלה. נסה לרענן את העמוד.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 pb-6">
        {templatesQuery.isLoading || shiftTypesQuery.isLoading ? (
          <ListSkeleton />
        ) : (
          (shiftTypesQuery.data ?? []).map((shift) => {
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Visual verification**

Using the Browser pane, open `/shift-templates`. Confirm all 5 templates still list correctly with their column counts.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ShiftTemplatesPage.tsx
git commit -m "$(cat <<'EOF'
Migrate ShiftTemplatesPage to useShiftTypes()

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Remove the static `SHIFTS` catalog from `shifts.ts`

**Files:**
- Modify: `src/constants/shifts.ts`

**Interfaces:** None — this is cleanup once nothing imports the static catalog.

- [ ] **Step 1: Confirm nothing still imports the static exports**

Run: `grep -rn "\bSHIFTS\b\|SHIFT_IDS_BY_CATEGORY\|getShiftById\|getShiftsByCategory" src/ --include=*.tsx --include=*.ts | grep -v "src/constants/shifts.ts"`

Expected: no output. (Tasks 3–8 migrated the only six call sites — `useActiveBoard`, `ShiftLivePage`, `RosterEditorPage`, `ShiftTemplateEditorPage`, `ShiftSetupPage`, `AdminPanelPage`, `ShiftTemplatesPage`. If this returns anything, stop and check which task's migration was incomplete before proceeding.)

- [ ] **Step 2: Delete the dead exports**

In `src/constants/shifts.ts`, delete these four blocks:

```ts
export const SHIFTS: ShiftConfig[] = [
  { id: 'morning_6', label: 'בוקר 6 מאבטחים', category: 'morning', startHour: 7, endHour: 15 },
  { id: 'morning_5', label: 'בוקר 5 מאבטחים', category: 'morning', startHour: 7, endHour: 15 },
  { id: 'afternoon_4', label: 'צהריים 4 מאבטחים', category: 'afternoon', startHour: 15, endHour: 23 },
  { id: 'afternoon_3', label: 'צהריים 3 מאבטחים', category: 'afternoon', startHour: 15, endHour: 23 },
  { id: 'night', label: 'לילה 2 מאבטחים', category: 'night', startHour: 23, endHour: 7 },
];
```

```ts
export const SHIFT_IDS_BY_CATEGORY: Record<ShiftCategory, string[]> = {
  morning: ['morning_6', 'morning_5'],
  afternoon: ['afternoon_4', 'afternoon_3'],
  night: ['night'],
};
```

```ts
export function getShiftById(id: string): ShiftConfig | undefined {
  return SHIFTS.find((s) => s.id === id);
}
```

```ts
export function getShiftsByCategory(category: ShiftCategory): ShiftConfig[] {
  return SHIFTS.filter((s) => s.category === category);
}
```

Everything else in the file (`ShiftCategory`, `ShiftConfig`, `SHIFT_CATEGORIES`, `getActiveCategory`, `buildShiftConfig`, `getShiftShortLabel`, `getShiftHoursLabel`, `getShiftFullTitle`) stays.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/constants/shifts.ts
git commit -m "$(cat <<'EOF'
Remove the static SHIFTS catalog — shift_types table is now the source

All seven call sites were migrated to useShiftTypes() in earlier
commits. Confirmed via grep that nothing in src/ still references
SHIFTS/SHIFT_IDS_BY_CATEGORY/getShiftById/getShiftsByCategory before
deleting them.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add "+ הוסף וריאנט" create UI to `ShiftTemplatesPage`

**Files:**
- Modify: `src/pages/ShiftTemplatesPage.tsx`

**Interfaces:**
- Consumes: `useCreateShiftTypeVariant` from `src/hooks/useShiftTypes.ts` (Task 2); `SHIFT_CATEGORIES`, `type ShiftCategory` from `src/constants/shifts.ts`.

- [ ] **Step 1: Update imports**

Replace:

```ts
import { useNavigate } from 'react-router-dom'
import { useShiftTemplates } from '../hooks/useShiftTemplates'
import { getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
```

with:

```ts
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftTemplates } from '../hooks/useShiftTemplates'
import { getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel, SHIFT_CATEGORIES, type ShiftCategory } from '../constants/shifts'
import { useShiftTypes, useCreateShiftTypeVariant } from '../hooks/useShiftTypes'

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}
```

- [ ] **Step 2: Add create-form state and handlers**

Inside `ShiftTemplatesPage`, right after `const shiftTypesQuery = useShiftTypes()`, add (the component already declares `const navigate = useNavigate()` above this — do not redeclare it, just add these new lines):

```ts
  const createVariantMutation = useCreateShiftTypeVariant()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createCategory, setCreateCategory] = useState<ShiftCategory>('morning')
  const [createGuardCount, setCreateGuardCount] = useState('')
  const [createCloneFromId, setCreateCloneFromId] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const allShifts = shiftTypesQuery.data ?? []
  const categoryVariants = allShifts.filter((s) => s.category === createCategory)

  function handleOpenCreateForm() {
    setCreateError(null)
    setCreateGuardCount('')
    setCreateCloneFromId(allShifts.find((s) => s.category === createCategory)?.id ?? null)
    setShowCreateForm(true)
  }

  function handleCreateCategoryPick(cat: ShiftCategory) {
    setCreateCategory(cat)
    setCreateCloneFromId(allShifts.find((s) => s.category === cat)?.id ?? null)
  }

  async function handleCreateSubmit() {
    const guardCountNum = Number(createGuardCount)

    if (!Number.isInteger(guardCountNum) || guardCountNum <= 0) {
      setCreateError('מספר מאבטחים חייב להיות מספר שלם חיובי.')
      return
    }

    if (!createCloneFromId) {
      setCreateError('יש לבחור וריאנט לשכפול.')
      return
    }

    setCreateError(null)

    try {
      const newShiftId = await createVariantMutation.mutateAsync({
        category: createCategory,
        guardCount: guardCountNum,
        cloneFromShiftId: createCloneFromId,
      })
      setShowCreateForm(false)
      navigate(`/shift-templates?shiftId=${encodeURIComponent(newShiftId)}`)
    } catch (error) {
      setCreateError(getReadableError(error))
    }
  }
```

(`navigate` was already declared at the top of the component from `useNavigate()` — this plan's diff shows it once more here only to make clear it's used by the new handler; do not duplicate the declaration if it already exists above.)

- [ ] **Step 3: Add the header button**

Replace:

```tsx
      <div className="bg-white border-b border-border px-4 pt-5 pb-4">
        <h1 className="text-xl font-bold text-text-primary">תבניות משמרת</h1>
        <p className="text-text-secondary text-sm mt-0.5">בחר תבנית כדי לערוך את תוכן הלוח שלה</p>
      </div>
```

with:

```tsx
      <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">תבניות משמרת</h1>
          <p className="text-text-secondary text-sm mt-0.5">בחר תבנית כדי לערוך את תוכן הלוח שלה</p>
        </div>
        <button
          onClick={handleOpenCreateForm}
          className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold text-primary bg-primary-light border border-primary/20 rounded-xl active:opacity-80 transition-opacity"
        >
          <span className="text-base leading-none">+</span> הוסף וריאנט
        </button>
      </div>
```

- [ ] **Step 4: Add the create-form bottom sheet**

At the very end of the component's returned JSX, right before the final closing `</div>` of the page's outer wrapper, add:

```tsx
      {showCreateForm && (
        <div
          onClick={() => setShowCreateForm(false)}
          className="fixed inset-0 bg-black/45 z-[100] flex items-end"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-mobile mx-auto bg-white rounded-t-[20px] safe-bottom p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-text-primary">הוסף וריאנט משמרת</span>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-text-muted p-1 active:opacity-70"
                aria-label="סגור"
              >
                ✕
              </button>
            </div>

            {createError && (
              <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
                {createError}
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-text-muted mb-1.5">קטגוריה</p>
              <div className="flex gap-2">
                {(Object.keys(SHIFT_CATEGORIES) as ShiftCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => handleCreateCategoryPick(cat)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                      createCategory === cat ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary'
                    }`}
                  >
                    {SHIFT_CATEGORIES[cat].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-text-muted mb-1.5">מספר מאבטחים</p>
              <input
                type="number"
                min="1"
                value={createGuardCount}
                onChange={(event) => setCreateGuardCount(event.target.value)}
                placeholder="לדוגמה: 7"
                className="w-full h-11 rounded-xl border border-border px-3 text-sm"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-text-muted mb-1.5">שכפל תוכן מ</p>
              {categoryVariants.length === 0 ? (
                <p className="text-sm text-text-secondary">אין וריאנט קיים בקטגוריה זו לשכפול.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {categoryVariants.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setCreateCloneFromId(s.id)}
                      className={`text-right px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                        createCloneFromId === s.id
                          ? 'border-primary ring-1 ring-primary text-primary font-bold'
                          : 'border-border text-text-primary'
                      }`}
                    >
                      {getShiftFullTitle(s)} · {getShiftShortLabel(s)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                void handleCreateSubmit()
              }}
              disabled={createVariantMutation.isPending || categoryVariants.length === 0}
              className="btn-primary w-full h-14 rounded-[14px] text-[15px] disabled:opacity-40"
            >
              {createVariantMutation.isPending ? 'יוצר...' : 'צור וריאנט'}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 6: Visual verification**

Using the Browser pane, log in as a manager and open `/shift-templates`:
1. Click "+ הוסף וריאנט". Confirm the sheet opens with "בוקר" pre-selected and its two existing variants listed under "שכפל תוכן מ" (one pre-selected).
2. Switch category to "לילה" — confirm the clone-from list updates to show only the `night` variant.
3. Enter guard count `9`, pick the `night` variant to clone from, click "צור וריאנט". Confirm it navigates to that new variant's editor and the grid content matches the `night` template's content.
4. Go back to `/shift-templates` — confirm the new "לילה 9 מאבטחים" card now appears in the list, and also appears in `/admin`'s picker sheet and `/shift-setup`'s לילה tab.
5. Try creating another variant with the same category+guard-count combination (e.g. `night`/9 again) — confirm it shows the Hebrew "כבר קיים וריאנט..." error inside the sheet rather than closing it.

Leave the created test variant in place — Task 11 will delete it as part of verifying the delete flow.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ShiftTemplatesPage.tsx
git commit -m "$(cat <<'EOF'
Add create-variant UI to ShiftTemplatesPage

Category + guard count + required "clone content from" picker (scoped
to the selected category's existing variants), calling the
create_shift_type_variant RPC and navigating straight to the new
variant's editor on success.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Add delete UI to `ShiftTemplatesPage`

**Files:**
- Modify: `src/pages/ShiftTemplatesPage.tsx`

**Interfaces:**
- Consumes: `useDeleteShiftTypeVariant` from `src/hooks/useShiftTypes.ts` (Task 2).

- [ ] **Step 1: Update the import**

Replace:

```ts
import { useShiftTypes, useCreateShiftTypeVariant } from '../hooks/useShiftTypes'
```

with:

```ts
import { useShiftTypes, useCreateShiftTypeVariant, useDeleteShiftTypeVariant } from '../hooks/useShiftTypes'
```

- [ ] **Step 2: Add delete state and handler**

Add near the other hooks:

```ts
  const deleteVariantMutation = useDeleteShiftTypeVariant()
  const [listError, setListError] = useState<string | null>(null)

  async function handleDeleteVariant(shiftId: string, event: React.MouseEvent) {
    event.stopPropagation()

    if (!window.confirm('האם אתה בטוח שברצונך למחוק את הווריאנט? לא ניתן לשחזר.')) {
      return
    }

    setListError(null)

    try {
      await deleteVariantMutation.mutateAsync(shiftId)
    } catch (error) {
      setListError(getReadableError(error))
    }
  }
```

- [ ] **Step 3: Show `listError` at the page level**

Replace:

```tsx
      {(templatesQuery.isError || shiftTypesQuery.isError) && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          טעינת התבניות נכשלה. נסה לרענן את העמוד.
        </div>
      )}
```

with:

```tsx
      {listError && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          {listError}
        </div>
      )}

      {(templatesQuery.isError || shiftTypesQuery.isError) && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          טעינת התבניות נכשלה. נסה לרענן את העמוד.
        </div>
      )}
```

(`listError` is shown at the page level, not inside the create-form sheet, because delete has no modal open when it happens — matching the lesson from the earlier AdminPanelPage fix, where an error rendered behind a still-open sheet looked broken. Create's own errors still render inside its sheet via `createError`, since that sheet is open when a create error occurs.)

- [ ] **Step 4: Add the delete button to each card**

Replace the card's returned JSX:

```tsx
              (shiftTypesQuery.data ?? []).map((shift) => {
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
```

with:

```tsx
              (shiftTypesQuery.data ?? []).map((shift) => {
            const template = templatesQuery.data?.find((t) => t.shift_id === shift.id)
            const isDeleting = deleteVariantMutation.isPending && deleteVariantMutation.variables === shift.id

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
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-[11px] text-text-muted">
                    {template ? `${template.cols.length} תפקידים` : '—'}
                  </span>
                  <span
                    role="button"
                    onClick={(event) => {
                      void handleDeleteVariant(shift.id, event)
                    }}
                    className={`text-[11px] font-medium text-danger active:opacity-70 ${
                      isDeleting ? 'pointer-events-none opacity-40' : ''
                    }`}
                  >
                    מחק
                  </span>
                </div>
              </button>
            )
          })
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 6: Visual verification**

Using the Browser pane, log in as a manager and open `/shift-templates`:
1. On the "לילה 9 מאבטחים" test variant created in Task 10, first go to `/admin` and create a roster board for it via "לוז חדש". Go back to `/shift-templates` and click "מחק" on that variant — confirm it's blocked with the Hebrew "לא ניתן למחוק וריאנט שיש לו לו״ז..." message shown at the page level (not inside a sheet).
2. Go to `/admin`, delete that board via its own "מחק" action. Return to `/shift-templates` and click "מחק" on the variant again — confirm this time it's confirmed and the variant disappears from the list.
3. Confirm it's also gone from `/admin`'s picker sheet and `/shift-setup`'s לילה tab.
4. Confirm the 5 original seeded variants are still all present and fully functional (list, admin picker, shift-setup) — nothing about them changed.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ShiftTemplatesPage.tsx
git commit -m "$(cat <<'EOF'
Add delete UI to ShiftTemplatesPage

מחק action per card, calling delete_shift_type_variant. The RPC's
"has an existing roster_boards row" rejection surfaces as a friendly
inline message at the page level (no modal is open during delete,
unlike create).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Final full regression pass

**Files:** None — verification only.

**Interfaces:** None.

- [ ] **Step 1: Full typecheck and build**

Run: `npx tsc -b && npm run build`
Expected: both clean.

- [ ] **Step 2: Full regression pass**

Using the Browser pane, log in as a manager and walk through every route touched across this whole plan:

- `/shift-live` — shift label/hours correct for the currently active category.
- `/shift-setup` — all 3 category tabs show correct variant cards; saving guard names still works.
- `/admin` — board list correct, "לוז חדש" flow still creates a board with correct seeded content, "תבניות משמרת" button present.
- `/roster-editor?id=...` — an existing board's title/subtitle correct.
- `/shift-templates` — list, editor, create, and delete all still correct; confirm the catalog now shows exactly the 5 original seeded variants (assuming the Task 10/11 test variant was cleaned up during their own verification).

- [ ] **Step 3: Update the plan's ledger (if using subagent-driven-development)**

If a `.superpowers/sdd/progress.md` ledger exists in this worktree from prior plans, add a final entry noting this plan's completion and the regression pass results.

- [ ] **Step 4: No commit needed for this task** (verification only — skip if nothing changed).
