-- ===== תמלול פלוס 3.0 =====
-- תפקיד "עורך"
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','editor','user'));
alter table public.profiles add column if not exists activity text;
alter table public.profiles add column if not exists groups uuid[] not null default '{}';

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor') and not disabled);
$$;
create or replace function public.my_groups() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce((select groups from public.profiles where id = auth.uid()), '{}');
$$;

-- דופק: נראה לאחרונה + מה עושה עכשיו
create or replace function public.touch_me(p_name text default null, p_activity text default null) returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen = now(), display_name = coalesce(nullif(p_name,''), display_name), activity = coalesce(p_activity, activity) where id = auth.uid();
$$;

-- קבוצות משתמשים
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;
drop policy if exists p_groups_sel on public.groups;
create policy p_groups_sel on public.groups for select using (public.is_active());
drop policy if exists p_groups_all on public.groups;
create policy p_groups_all on public.groups for all using (public.is_admin()) with check (public.is_admin());

-- תיקיות: שיתוף לקבוצות + דף ציבורי / פודקאסט
alter table public.folders add column if not exists shared_groups uuid[] not null default '{}';
alter table public.folders add column if not exists public_slug text unique;
alter table public.folders add column if not exists public_title text;
alter table public.folders add column if not exists public_desc text;

drop policy if exists p_folders_sel on public.folders;
create policy p_folders_sel on public.folders for select using (public.is_active() and (owner = auth.uid() or auth.uid() = any(shared_with) or shared_groups && public.my_groups() or public.is_admin() or public.is_editor()));

-- הקלטות: סדרות, נעילה
alter table public.recordings add column if not exists series text;
alter table public.recordings add column if not exists series_no integer;
alter table public.recordings add column if not exists locked boolean not null default false;

drop policy if exists p_rec_sel on public.recordings;
create policy p_rec_sel on public.recordings for select using (
  public.is_active() and (
    public.is_admin()
    or (public.is_editor() and deleted_at is null)
    or (owner = auth.uid() and deleted_at is null)
    or (deleted_at is null and folder_id in (select id from public.folders where owner = auth.uid() or auth.uid() = any(shared_with) or shared_groups && public.my_groups()))
  ));
drop policy if exists p_rec_upd on public.recordings;
create policy p_rec_upd on public.recordings for update using (public.is_active() and (owner = auth.uid() or public.is_editor()));

-- הקלטה נעולה: רק מנהל משנה
create or replace function public.guard_locked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.locked and not public.is_admin() and auth.uid() is not null then
    raise exception 'ההקלטה נעולה – רק מנהל יכול לשנות אותה';
  end if;
  if new.locked is distinct from old.locked and not public.is_admin() and auth.uid() is not null then
    raise exception 'רק מנהל יכול לנעול או לשחרר';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_locked on public.recordings;
create trigger trg_guard_locked before update on public.recordings for each row execute function public.guard_locked();

-- היסטוריית גרסאות
create table if not exists public.rec_versions (
  id bigint generated always as identity primary key,
  rec_id uuid not null references public.recordings(id) on delete cascade,
  user_id uuid,
  title text, text text, segments jsonb,
  created_at timestamptz not null default now()
);
create index if not exists rec_versions_rec_idx on public.rec_versions(rec_id);
alter table public.rec_versions enable row level security;
drop policy if exists p_ver_sel on public.rec_versions;
create policy p_ver_sel on public.rec_versions for select using (exists (select 1 from public.recordings r where r.id = rec_id));
create or replace function public.save_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.text is distinct from new.text or old.title is distinct from new.title) and old.status = 'done' and coalesce(old.text,'') <> '' then
    insert into public.rec_versions(rec_id, user_id, title, text, segments) values (old.id, auth.uid(), old.title, old.text, old.segments);
  end if;
  return new;
end $$;
drop trigger if exists trg_save_version on public.recordings;
create trigger trg_save_version after update on public.recordings for each row execute function public.save_version();

-- הודעות פנימיות (to_user ריק = למנהלים)
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  from_user uuid references public.profiles(id) on delete cascade default auth.uid(),
  to_user uuid references public.profiles(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
drop policy if exists p_msg_sel on public.messages;
create policy p_msg_sel on public.messages for select using (from_user = auth.uid() or to_user = auth.uid() or (to_user is null and public.is_admin()));
drop policy if exists p_msg_ins on public.messages;
create policy p_msg_ins on public.messages for insert with check (public.is_active() and from_user = auth.uid() and (to_user is null or public.is_admin() or exists (select 1 from public.profiles p where p.id = to_user and p.role = 'admin')));
drop policy if exists p_msg_upd on public.messages;
create policy p_msg_upd on public.messages for update using (to_user = auth.uid() or (to_user is null and public.is_admin()));
drop policy if exists p_msg_del on public.messages;
create policy p_msg_del on public.messages for delete using (public.is_admin() or from_user = auth.uid());

-- התראות
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  rec_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
drop policy if exists p_not_sel on public.notifications;
create policy p_not_sel on public.notifications for select using (user_id = auth.uid());
drop policy if exists p_not_ins on public.notifications;
create policy p_not_ins on public.notifications for insert with check (public.is_active());
drop policy if exists p_not_upd on public.notifications;
create policy p_not_upd on public.notifications for update using (user_id = auth.uid());
drop policy if exists p_not_del on public.notifications;
create policy p_not_del on public.notifications for delete using (user_id = auth.uid());

-- בקשות הצטרפות (נכתבות רק דרך השרת)
create table if not exists public.access_requests (
  id bigint generated always as identity primary key,
  email text not null, name text, note text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;
drop policy if exists p_req_all on public.access_requests;
create policy p_req_all on public.access_requests for all using (public.is_admin()) with check (public.is_admin());

-- מועדפים, התקדמות האזנה ורשימות השמעה – אישיים
create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  rec_id uuid not null references public.recordings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, rec_id)
);
create table if not exists public.progress (
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  rec_id uuid not null references public.recordings(id) on delete cascade,
  pos double precision default 0, pct integer default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, rec_id)
);
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name text not null,
  rec_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.favorites enable row level security;
alter table public.progress enable row level security;
alter table public.playlists enable row level security;
drop policy if exists p_fav on public.favorites;
create policy p_fav on public.favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists p_prog on public.progress;
create policy p_prog on public.progress for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());
drop policy if exists p_pl on public.playlists;
create policy p_pl on public.playlists for all using (owner = auth.uid()) with check (owner = auth.uid());

-- תגובות ובקשות תיקון
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  rec_id uuid not null references public.recordings(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null default 'comment',          -- comment / fix
  seg integer, t double precision,
  body text not null, suggestion text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists comments_rec_idx on public.comments(rec_id);
alter table public.comments enable row level security;
drop policy if exists p_com_sel on public.comments;
create policy p_com_sel on public.comments for select using (exists (select 1 from public.recordings r where r.id = rec_id));
drop policy if exists p_com_ins on public.comments;
create policy p_com_ins on public.comments for insert with check (public.is_active() and user_id = auth.uid() and exists (select 1 from public.recordings r where r.id = rec_id));
drop policy if exists p_com_upd on public.comments;
create policy p_com_upd on public.comments for update using (public.is_editor() or exists (select 1 from public.recordings r where r.id = rec_id and r.owner = auth.uid()));
drop policy if exists p_com_del on public.comments;
create policy p_com_del on public.comments for delete using (user_id = auth.uid() or public.is_admin());

-- דלי גיבויים פרטי
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;

-- רשימת אנשים: גם תפקיד
create or replace function public.list_people()
returns table(id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.display_name, split_part(p.email,'@',1)) from public.profiles p
  where public.is_active() and not p.disabled order by 2;
$$;

-- לוח בקרה חי למנהל
create or replace function public.admin_live()
returns table(user_id uuid, display_name text, email text, last_seen timestamptz, activity text, queued bigint, processing bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.last_seen, p.activity,
    (select count(*) from public.recordings r where r.owner = p.id and r.status = 'queued' and r.deleted_at is null),
    (select count(*) from public.recordings r where r.owner = p.id and r.status = 'processing' and r.deleted_at is null)
  from public.profiles p where public.is_admin() order by p.last_seen desc nulls last;
$$;

insert into public.app_settings(key, value) values
  ('brand', '{}'::jsonb), ('watermark', '""'::jsonb), ('audio_retention_days', '0'::jsonb),
  ('speakers', '[]'::jsonb), ('hilulot', '[]'::jsonb), ('admin_2fa', 'false'::jsonb), ('monthly_report', 'true'::jsonb)
on conflict (key) do nothing;

select 'ok' as result;
