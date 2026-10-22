-- Reverses phase21_schedule_worker_links.sql. Safe at any time: nothing else
-- depends on these objects except the client that calls get_my_shifts, so roll
-- the code back first (the "My shifts" tab then shows an error until then).
drop function if exists public.get_my_shifts(date);
drop function if exists public.unlink_schedule_worker(text);
drop function if exists public.link_schedule_worker(text, uuid);
drop table if exists public.schedule_worker_links;
drop function if exists public.person_name_key(text);
