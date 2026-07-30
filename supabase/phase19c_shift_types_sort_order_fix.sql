-- GuardFlow Phase 19c — scope new variants' sort_order to their category
--
-- create_shift_type_variant previously used max(sort_order)+1 across the
-- whole table, so a newly created variant always sorted after every
-- existing one regardless of category — e.g. a new morning variant would
-- appear below the night variant in /shift-templates and /admin's picker.
-- Scoping the max to the same category keeps new variants grouped with
-- their siblings, matching how ShiftSetupPage already groups by category.

create or replace function public.create_shift_type_variant(
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
    coalesce((select max(sort_order) from public.shift_types where category = p_category), 0) + 1
  );

  insert into public.shift_templates (shift_id, cols, rows, notes)
  values (new_id, source_cols, source_rows, null);

  return new_id;
end;
$$;

revoke all on function public.create_shift_type_variant(text, int, text) from public;
grant execute on function public.create_shift_type_variant(text, int, text) to authenticated;
