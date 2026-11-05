-- תיק עבודות (קידומת pf_ – הפרויקט משותף עם טבלאות ישנות): תוכן, עמודים, היסטוריה וקבצים
-- כתיבה: רק משתמשת שהמייל שלה ברשימת admins. קריאה ציבורית: רק מה שמוצג.

create table if not exists public.pf_admins (
  email text primary key
);
alter table public.pf_admins enable row level security;
-- אין מדיניות: אף אחד לא קורא או כותב דרך ה-API. עורכים רק מה-SQL.

create or replace function public.pf_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pf_admins a
    join auth.users u on lower(u.email) = lower(a.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.pf_is_admin() from public;
grant execute on function public.pf_is_admin() to anon, authenticated;

-- פריטים: סרטון / אתר / קבוצת כלים
create table if not exists public.pf_entries (
  id text primary key,
  type text not null check (type in ('video','site','skillgroup')),
  status text not null default 'publish' check (status in ('publish','hidden','trash')),
  sort integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists pf_entries_type_sort on public.pf_entries (type, sort);
alter table public.pf_entries enable row level security;
create policy "public reads published entries" on public.pf_entries
  for select to anon, authenticated using (status = 'publish' or public.pf_is_admin());
create policy "admin writes entries" on public.pf_entries
  for all to authenticated using (public.pf_is_admin()) with check (public.pf_is_admin());

-- עמודים וחלקים משותפים: הגרסה המפורסמת (ציבורית)
create table if not exists public.pf_site_docs (
  id text primary key,               -- home / header / footer
  doc jsonb not null,
  revision integer not null default 1,
  published_at timestamptz not null default now()
);
alter table public.pf_site_docs enable row level security;
create policy "public reads docs" on public.pf_site_docs
  for select to anon, authenticated using (true);
create policy "admin writes docs" on public.pf_site_docs
  for all to authenticated using (public.pf_is_admin()) with check (public.pf_is_admin());

-- טיוטות: רק המנהלת רואה
create table if not exists public.pf_site_drafts (
  id text primary key references public.pf_site_docs(id) on delete cascade,
  doc jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.pf_site_drafts enable row level security;
create policy "admin drafts" on public.pf_site_drafts
  for all to authenticated using (public.pf_is_admin()) with check (public.pf_is_admin());

-- היסטוריית פרסומים
create table if not exists public.pf_revisions (
  id bigint generated always as identity primary key,
  doc_id text not null,
  doc jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists pf_revisions_doc on public.pf_revisions (doc_id, created_at desc);
alter table public.pf_revisions enable row level security;
create policy "admin revisions" on public.pf_revisions
  for all to authenticated using (public.pf_is_admin()) with check (public.pf_is_admin());

-- הגדרות: פתיחה, קשר, קו"ח, גוגל
create table if not exists public.pf_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.pf_settings enable row level security;
create policy "public reads settings" on public.pf_settings
  for select to anon, authenticated using (true);
create policy "admin writes settings" on public.pf_settings
  for all to authenticated using (public.pf_is_admin()) with check (public.pf_is_admin());

-- פרסום: שומר את הטיוטה כגרסה מפורסמת + היסטוריה. נכשל אם הטיוטה השתנתה בחלון אחר.
create or replace function public.pf_publish_doc(p_id text, p_revision integer)
returns integer language plpgsql security definer set search_path = public as $$
declare d record; new_rev integer;
begin
  if not public.pf_is_admin() then raise exception 'אין הרשאה'; end if;
  select * into d from public.pf_site_drafts where id = p_id for update;
  if not found then raise exception 'אין טיוטה לפרסם'; end if;
  if d.revision <> p_revision then raise exception 'התוכן השתנה בחלון אחר. רעננו את העמוד.'; end if;
  update public.pf_site_docs set doc = d.doc, revision = revision + 1, published_at = now()
    where id = p_id returning revision into new_rev;
  insert into public.pf_revisions (doc_id, doc) values (p_id, d.doc);
  return new_rev;
end $$;
revoke all on function public.pf_publish_doc(text, integer) from public;
grant execute on function public.pf_publish_doc(text, integer) to authenticated;

-- שמירת טיוטה עם בדיקת revision
create or replace function public.pf_save_draft(p_id text, p_doc jsonb, p_revision integer)
returns integer language plpgsql security definer set search_path = public as $$
declare cur integer;
begin
  if not public.pf_is_admin() then raise exception 'אין הרשאה'; end if;
  select revision into cur from public.pf_site_drafts where id = p_id for update;
  if not found then
    insert into public.pf_site_drafts (id, doc, revision) values (p_id, p_doc, 1);
    return 1;
  end if;
  if cur <> p_revision then raise exception 'התוכן השתנה בחלון אחר. רעננו את העמוד.'; end if;
  update public.pf_site_drafts set doc = p_doc, revision = cur + 1, updated_at = now() where id = p_id;
  return cur + 1;
end $$;
revoke all on function public.pf_save_draft(text, jsonb, integer) from public;
grant execute on function public.pf_save_draft(text, jsonb, integer) to authenticated;

-- קבצים: תיקייה ציבורית לקריאה, העלאה רק למנהלת
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 52428800,
  array['video/mp4','image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "pf admin uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'portfolio' and public.pf_is_admin());
create policy "pf admin updates" on storage.objects
  for update to authenticated using (bucket_id = 'portfolio' and public.pf_is_admin());
create policy "pf admin deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'portfolio' and public.pf_is_admin());

insert into public.pf_admins (email) values ('batyamanevitz@gmail.com') on conflict do nothing;

create policy "pf admin lists" on storage.objects
  for select to authenticated using (bucket_id = 'portfolio' and public.pf_is_admin());

-- (migration 2) פונקציות הכתיבה – רק למשתמשים מחוברים
revoke execute on function public.pf_publish_doc(text, integer) from anon;
revoke execute on function public.pf_save_draft(text, jsonb, integer) from anon;
