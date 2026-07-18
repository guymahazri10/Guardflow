-- GuardFlow Phase 7 (build roadmap Phase 6) — profiles visible to commander
--
-- PositionChangeNotifier requires linking a guard_names role entry to a
-- user_id, entered from the Setup screen. Both managers and commanders can
-- edit Setup, so both need to search public.profiles for a matching user
-- (GuardNameInput). Widen the manager-only visibility from Phase 6 to also
-- include אחמ"ש. Role changes (set_user_app_role) remain manager-only —
-- this migration only touches SELECT visibility.

drop policy if exists "profiles select own or manager" on public.profiles;
create policy "profiles select own or manager or commander"
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or public.get_my_role() in ('מנהל', 'אחמ"ש')
  );
