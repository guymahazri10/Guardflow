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
