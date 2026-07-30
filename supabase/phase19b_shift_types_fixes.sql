-- GuardFlow Phase 19b — fixes from the whole-branch review
--
-- 1. service_role never got a grant on shift_types (same root cause as
--    phase10/phase13: RLS policies don't help a service-role admin client,
--    which bypasses RLS but still needs the underlying GRANT). The two
--    edge functions that read the shift catalog (send-position-push,
--    reset-shift-names) are being updated in this same fix to query
--    shift_types instead of a hardcoded copy of the old static array —
--    this grant is what makes that query actually work.
--
-- 2. roster_boards.shift_id had no foreign key to shift_types, so
--    delete_shift_type_variant's "no existing board" pre-check had a real
--    TOCTOU race under READ COMMITTED (no predicate locking on a
--    zero-row match) and, if hit, would leave an orphaned board that
--    silently disappears from /admin (which filters by the shift_types
--    catalog) while still being served by ShiftLivePage if published.
--    This was reachable for the first time once delete_shift_type_variant
--    existed — no prior code path could ever delete a shift_id.
--
-- 3. Deleting the last variant in a category was an unrecoverable trap:
--    with "clone from an existing variant in this category" mandatory,
--    an empty category can never be repopulated from the app.
--    delete_shift_type_variant now blocks that case; recreated here via
--    create or replace since a new check clause needed to be added.
--
-- 4. A unique (category, guard_count) constraint makes the "no duplicate
--    variant" invariant declarative — the deterministic id
--    (category || '_' || guard_count) already caught this in practice via
--    the primary key, but this also closes a hypothetical direct-SQL edit
--    gap (e.g. the legacy 'night' row's shape colliding with a
--    would-be 'night_2').

grant select on public.shift_types to service_role;

alter table public.roster_boards
  add constraint roster_boards_shift_id_fkey
  foreign key (shift_id) references public.shift_types(id);

alter table public.shift_types
  add constraint shift_types_category_guard_count_key
  unique (category, guard_count);

create or replace function public.delete_shift_type_variant(p_shift_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_category text;
begin
  if public.get_my_role() <> 'מנהל' then
    raise exception 'Not authorized to delete shift variants' using errcode = '42501';
  end if;

  select category into target_category from public.shift_types where id = p_shift_id;

  if target_category is null then
    raise exception 'Shift variant not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.roster_boards where shift_id = p_shift_id) then
    raise exception 'לא ניתן למחוק וריאנט שיש לו לו״ז קיים — יש למחוק קודם את הלו״ז מ-/admin' using errcode = '23503';
  end if;

  if (select count(*) from public.shift_types where category = target_category) <= 1 then
    raise exception 'לא ניתן למחוק את הווריאנט האחרון בקטגוריה — יש ליצור וריאנט חלופי לפני המחיקה' using errcode = '23514';
  end if;

  delete from public.shift_templates where shift_id = p_shift_id;
  delete from public.shift_types where id = p_shift_id;
end;
$$;

revoke all on function public.delete_shift_type_variant(text) from public;
grant execute on function public.delete_shift_type_variant(text) to authenticated;
