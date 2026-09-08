-- ApplyPilot v2: additive, transactional, repeat-safe upgrade.
-- Run as the database owner in the Supabase SQL editor BEFORE using the v2 frontend.
-- No legacy Applications/Resumes columns or rows are deleted/replaced.
-- Incompatible pre-existing objects fail closed; never use IF NOT EXISTS as schema validation.
begin;
set local lock_timeout = '5s';
-- Serialize concurrent executions of this migration (transaction-scoped).
select pg_advisory_xact_lock(180154787, 2);

do $$
declare requirement record; actual oid;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='Applications' and c.relkind='r' and c.relrowsecurity
  ) then raise exception 'Applications must be an existing table with RLS enabled'; end if;
  if to_regclass('public.resume_profiles') is not null and
     to_regclass('public.applypilot_migration_state') is null then
    raise exception 'Unmarked pre-existing v2 schema: reconcile earlier/partial migration before running this file';
  end if;
  -- Only the columns used by this migration are checked here. Application IDs need not be UUIDs.
  for requirement in select * from (values
    ('Applications','user_id','uuid'), ('Applications','status',null),
    ('Applications','match',null), ('Applications','raw_text',null), ('Applications','deadline',null),
    ('Resumes','user_id','uuid'), ('Resumes','text','text'), ('Resumes','updated_at',null)
  ) as r(tbl,col,typ) loop
    select atttypid into actual from pg_attribute
    where attrelid=to_regclass(format('public.%I',requirement.tbl))
      and attname=requirement.col and attnum>0 and not attisdropped;
    if actual is null or (requirement.typ is not null and actual<>to_regtype(requirement.typ)) then
      raise exception 'Missing or incompatible prerequisite: %.%',requirement.tbl,requirement.col;
    end if;
  end loop;
  if not exists(select 1 from pg_attribute where attrelid='public."Resumes"'::regclass
    and attname='updated_at' and atttypid in ('timestamp'::regtype,'timestamptz'::regtype)) then
    raise exception 'Resumes.updated_at must be timestamp or timestamptz';
  end if;
  -- Keep the legacy copy consistent while this transaction is running.
  lock table public."Resumes" in share mode;
  if exists(select 1 from public."Resumes" where user_id is null)
     or exists(select 1 from public."Resumes" group by user_id having count(*)>1) then
    raise exception 'Legacy Resumes must have one non-null user_id per row; resolve duplicates before migration';
  end if;
end $$;

-- Owner-only receipt: data backfills run exactly once, including after deliberate profile deletion.
create table if not exists public.applypilot_migration_state (
  name text primary key,
  completed_at timestamptz not null default now()
);
alter table public.applypilot_migration_state enable row level security;
revoke all on public.applypilot_migration_state from public, anon, authenticated;

create table if not exists public.resume_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Primary Resume' check (length(title) between 1 and 120),
  text text not null default '' check (length(text)<=100000),
  notes text not null default '' check (length(notes)<=5000),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,id)
);
alter table public."Applications" add column if not exists source_url text;
alter table public."Applications" add column if not exists employment_type text;
alter table public."Applications" add column if not exists resume_id uuid;
alter table public."Applications" add column if not exists v2_data jsonb not null default '{}'::jsonb;
alter table public."Applications" add column if not exists v2_version integer not null default 0;

-- Verify reused columns instead of silently accepting an incompatible partial/manual schema.
do $$
declare requirement record; actual record;
begin
  for requirement in select * from (values
    ('resume_profiles','id','uuid',true), ('resume_profiles','user_id','uuid',true),
    ('resume_profiles','title','text',true), ('resume_profiles','text','text',true),
    ('resume_profiles','notes','text',true), ('resume_profiles','is_default','boolean',true),
    ('resume_profiles','created_at','timestamptz',true), ('resume_profiles','updated_at','timestamptz',true),
    ('Applications','source_url','text',false), ('Applications','employment_type','text',false),
    ('Applications','resume_id','uuid',false), ('Applications','v2_data','jsonb',true),
    ('Applications','v2_version','integer',true),
    ('applypilot_migration_state','name','text',true), ('applypilot_migration_state','completed_at','timestamptz',true)
  ) as r(tbl,col,typ,required) loop
    select atttypid,attnotnull into actual from pg_attribute
      where attrelid=to_regclass(format('public.%I',requirement.tbl))
      and attname=requirement.col and attnum>0 and not attisdropped;
    if actual.atttypid is distinct from to_regtype(requirement.typ)::oid
       or (requirement.required and actual.attnotnull is distinct from true) then
      raise exception 'Incompatible v2 schema: %.%',requirement.tbl,requirement.col;
    end if;
  end loop;
  for requirement in select * from (values
    ('resume_profiles','id','gen_random_uuid()'),
    ('resume_profiles','title',quote_literal('Primary Resume')||'::text'),
    ('resume_profiles','text',quote_literal('')||'::text'),
    ('resume_profiles','notes',quote_literal('')||'::text'),
    ('resume_profiles','is_default','false'),
    ('resume_profiles','created_at','now()'), ('resume_profiles','updated_at','now()'),
    ('Applications','v2_data',quote_literal('{}')||'::jsonb'), ('Applications','v2_version','0'),
    ('applypilot_migration_state','completed_at','now()')
  ) as r(tbl,col,expected) loop
    if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(format('public.%I',requirement.tbl)) and a.attname=requirement.col
      and pg_get_expr(d.adbin,d.adrelid)=requirement.expected) then
      raise exception 'Incompatible v2 default: %.%',requirement.tbl,requirement.col;
    end if;
  end loop;
end $$;

-- Verify the constraints of a reused resume table; do not silently accept weakened definitions.
do $$
declare rel oid:='public.resume_profiles'::regclass; id_col smallint; owner_col smallint; requirement record;
begin
  select attnum into id_col from pg_attribute where attrelid=rel and attname='id';
  select attnum into owner_col from pg_attribute where attrelid=rel and attname='user_id';
  if not exists(select 1 from pg_constraint where conrelid=rel and contype='p' and conkey=array[id_col])
     or not exists(select 1 from pg_constraint where conrelid=rel and contype='u' and conkey=array[owner_col,id_col] and not condeferrable)
     or not exists(select 1 from pg_constraint where conrelid=rel and contype='f' and conkey=array[owner_col]
       and confrelid='auth.users'::regclass and confdeltype='c' and convalidated and not condeferrable
       and confkey=array[(select attnum from pg_attribute where attrelid='auth.users'::regclass and attname='id')]) then
    raise exception 'Incompatible resume profile identity/ownership constraints';
  end if;
  for requirement in select * from (values
    ('resume_profiles_title_check','lengthtitle>=1ANDlengthtitle<=120'),
    ('resume_profiles_text_check','lengthtext<=100000'),
    ('resume_profiles_notes_check','lengthnotes<=5000')
  ) as r(name,expression) loop
    if not exists(select 1 from pg_constraint where conrelid=rel and conname=requirement.name
      and contype='c' and convalidated
      and regexp_replace(pg_get_expr(conbin,conrelid),'[()[:space:]]','','g')=requirement.expression) then
      raise exception 'Incompatible resume profile constraint: %',requirement.name;
    end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.applypilot_migration_state'::regclass and contype='p'
    and conkey=array[(select attnum from pg_attribute where attrelid='public.applypilot_migration_state'::regclass and attname='name')]) then
    raise exception 'Incompatible migration receipt identity constraint';
  end if;
end $$;

create unique index if not exists resume_profiles_one_default
  on public.resume_profiles(user_id) where is_default;
create index if not exists applications_resume_idx on public."Applications"(user_id,resume_id);
-- A same-named index/constraint on another table must not bypass security enforcement.
do $$
begin
  if not exists (
    select 1 from pg_index i
    where i.indexrelid=to_regclass('public.resume_profiles_one_default')
      and i.indrelid='public.resume_profiles'::regclass and i.indisunique and i.indisvalid
      and pg_get_indexdef(i.indexrelid,1,true)='user_id' and i.indnkeyatts=1
      and pg_get_expr(i.indpred,i.indrelid)='is_default'
  ) then raise exception 'Incompatible resume_profiles_one_default index'; end if;
  if not exists (
    select 1 from pg_index i where i.indexrelid=to_regclass('public.applications_resume_idx')
      and i.indrelid='public."Applications"'::regclass and i.indisvalid and i.indpred is null
      and pg_get_indexdef(i.indexrelid,1,true)='user_id'
      and pg_get_indexdef(i.indexrelid,2,true)='resume_id' and i.indnkeyatts=2
  ) then raise exception 'Incompatible applications_resume_idx index'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public."Applications"'::regclass and conname='applications_resume_owner_fk') then
    alter table public."Applications" add constraint applications_resume_owner_fk
      foreign key(user_id,resume_id) references public.resume_profiles(user_id,id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public."Applications"'::regclass and c.conname='applications_resume_owner_fk'
      and c.contype='f' and c.confrelid='public.resume_profiles'::regclass
      and c.confdeltype='r' and c.confupdtype='a' and not c.condeferrable and c.convalidated
      and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='user_id'),
                        (select attnum from pg_attribute where attrelid=c.conrelid and attname='resume_id')]
      and c.confkey=array[(select attnum from pg_attribute where attrelid=c.confrelid and attname='user_id'),
                         (select attnum from pg_attribute where attrelid=c.confrelid and attname='id')]
  ) then raise exception 'Incompatible applications_resume_owner_fk constraint'; end if;
end $$;

alter table public.resume_profiles enable row level security;
drop policy if exists resume_profiles_owner on public.resume_profiles;
create policy resume_profiles_owner on public.resume_profiles for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
-- Restrictive policy also protects against any additional permissive policy on an existing table.
drop policy if exists resume_profiles_owner_guard on public.resume_profiles;
create policy resume_profiles_owner_guard on public.resume_profiles as restrictive for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
-- Supabase default privileges may include TRUNCATE, which bypasses RLS. Grant only DML.
revoke all on public.resume_profiles from public, anon, authenticated;
grant select,insert,update,delete on public.resume_profiles to authenticated;

-- Copy once. Deliberately cleared assignments/defaults and deleted profiles stay that way on reruns.
-- The receipt and all copied data commit or roll back together.
do $$
begin
  if not exists(select 1 from public.applypilot_migration_state where name='001_applypilot_v2_legacy_copy') then
    -- A pre-existing profile with legacy text could represent an earlier v2 rollout.
    -- Never overwrite it. Fail rather than silently skip copying an unmatched legacy resume.
    if exists (
      select 1 from public."Resumes" r
      where exists(select 1 from public.resume_profiles p where p.user_id=r.user_id)
        and not exists(select 1 from public.resume_profiles p where p.user_id=r.user_id and p.text=coalesce(r.text,''))
    ) then raise exception 'Existing profiles differ from legacy resumes; reconcile before first v2 backfill'; end if;
    insert into public.resume_profiles(user_id,title,text,is_default,updated_at)
      select r.user_id,'Primary Resume',coalesce(r.text,''),true,coalesce(r.updated_at,now())
      from public."Resumes" r
      where not exists(select 1 from public.resume_profiles p where p.user_id=r.user_id);
    update public."Applications" a set resume_id=p.id from public.resume_profiles p
      where a.user_id=p.user_id and p.is_default and a.resume_id is null;
    insert into public.applypilot_migration_state(name) values('001_applypilot_v2_legacy_copy');
  end if;
end $$;

-- Timestamp authority belongs to PostgreSQL even for RPCs/direct API updates.
create or replace function public.applypilot_resume_timestamp() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  new.updated_at:=clock_timestamp();
  return new;
end $$;
drop trigger if exists applypilot_resume_timestamp_trigger on public.resume_profiles;
create trigger applypilot_resume_timestamp_trigger before update on public.resume_profiles
  for each row execute function public.applypilot_resume_timestamp();

-- Missing/JSON-null history is empty. A valid legacy single event is wrapped without data loss.
-- Malformed nonempty history is rejected, never silently discarded or concatenated as a scalar.
create or replace function public.applypilot_normalize_events(value jsonb) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare events jsonb; event jsonb; event_time timestamptz;
begin
  if value is null or value='null'::jsonb then return '[]'::jsonb; end if;
  events:=case when jsonb_typeof(value)='object' then jsonb_build_array(value) else value end;
  if jsonb_typeof(events) is distinct from 'array' then
    raise exception using errcode='23514',message='Activity history must be an array of valid events';
  end if;
  for event in select v from jsonb_array_elements(events) as e(v) loop
    if jsonb_typeof(event) is distinct from 'object'
       or jsonb_typeof(event->'title') is distinct from 'string'
       or length(btrim(event->>'title')) not between 1 and 5000
       or jsonb_typeof(event->'at') is distinct from 'string'
       or (event->>'at') !~ '^\d{4}-\d{2}-\d{2}T' then
      raise exception using errcode='23514',message='Invalid activity event structure';
    end if;
    begin event_time:=(event->>'at')::timestamptz;
    exception when others then raise exception using errcode='23514',message='Invalid activity event date'; end;
    if not isfinite(event_time) then raise exception using errcode='23514',message='Invalid activity event date'; end if;
    if event ? 'id' and jsonb_typeof(event->'id') is distinct from 'string' then
      raise exception using errcode='23514',message='Invalid activity event id';
    end if;
    if event ? 'type' and jsonb_typeof(event->'type') is distinct from 'string' then
      raise exception using errcode='23514',message='Invalid activity event type';
    end if;
    if event->>'type'='status_changed' and
       (jsonb_typeof(event->'status') is distinct from 'string' or event->>'status' not in ('saved','applied','interview','offer','rejected')) then
      raise exception using errcode='23514',message='Invalid activity event status';
    end if;
  end loop;
  return events;
end $$;

-- Validate structures read by the frontend, in addition to the trigger's own pendingEvent input.
create or replace function public.applypilot_validate_workspace(payload jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare key text; item jsonb; entry record; item_date timestamptz;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception using errcode='23514',message='Workspace data must be an object';
  end if;
  if octet_length(payload::text)>500000 then
    raise exception using errcode='23514',message='Workspace data exceeds 500000 bytes';
  end if;
  if payload ? 'pendingEvent' and (jsonb_typeof(payload->'pendingEvent') is distinct from 'string'
     or length(btrim(payload->>'pendingEvent')) not between 1 and 5000) then
    raise exception using errcode='23514',message='Activity note must be a nonempty string of at most 5000 characters';
  end if;
  perform public.applypilot_normalize_events(payload->'events');
  foreach key in array array['interviews','reminders'] loop
    if payload ? key then
      if jsonb_typeof(payload->key) is distinct from 'array' then
        raise exception using errcode='23514',message='Interviews and reminders must be arrays';
      end if;
      for item in select v from jsonb_array_elements(payload->key) as e(v) loop
        if jsonb_typeof(item) is distinct from 'object'
           or jsonb_typeof(item->'id') is distinct from 'string'
           or length(item->>'id') not between 1 and 160
           or jsonb_typeof(item->'title') is distinct from 'string'
           or length(btrim(item->>'title')) not between 1 and 160
           or jsonb_typeof(item->'date') is distinct from 'string'
           or (item->>'date') !~ '^\d{4}-\d{2}-\d{2}T' then
          raise exception using errcode='23514',message='Invalid interview or reminder structure';
        end if;
        begin item_date:=(item->>'date')::timestamptz;
        exception when others then raise exception using errcode='23514',message='Invalid interview or reminder date'; end;
        if not isfinite(item_date) then raise exception using errcode='23514',message='Invalid interview or reminder date'; end if;
        if key='interviews' and (jsonb_typeof(item->'status') is distinct from 'string'
           or item->>'status' not in ('Upcoming','Completed','Cancelled')) then
          raise exception using errcode='23514',message='Invalid interview status';
        end if;
        if key='reminders' and jsonb_typeof(item->'completed') is distinct from 'boolean' then
          raise exception using errcode='23514',message='Invalid reminder completion';
        end if;
        for entry in select * from jsonb_each(item) where jsonb_each.key in
          ('type','location','interviewer','interviewerTitle','notes','timezone') loop
          if jsonb_typeof(entry.value) is distinct from 'string' or length(entry.value#>>'{}')>5000 then
            raise exception using errcode='23514',message='Invalid interview or reminder text';
          end if;
        end loop;
      end loop;
      if exists(select 1 from jsonb_array_elements(payload->key) as e(v) group by v->>'id' having count(*)>1) then
        raise exception using errcode='23514',message='Duplicate interview or reminder id';
      end if;
    end if;
  end loop;
  if payload ? 'answers' then
    if jsonb_typeof(payload->'answers') is distinct from 'object' then
      raise exception using errcode='23514',message='Preparation answers must be an object';
    end if;
    for item in select value from jsonb_each(payload->'answers') loop
      if jsonb_typeof(item) is distinct from 'string' or length(item#>>'{}')>10000 then
        raise exception using errcode='23514',message='Invalid preparation answer';
      end if;
    end loop;
  end if;
  if payload ? 'tailoredText' and (jsonb_typeof(payload->'tailoredText') is distinct from 'string'
     or length(payload->>'tailoredText')>100000) then
    raise exception using errcode='23514',message='Invalid role resume draft';
  end if;
  foreach key in array array['analysis','tailoring','prep'] loop
    if payload ? key and jsonb_typeof(payload->key) is distinct from 'object' then
      raise exception using errcode='23514',message='Stored AI results must be objects';
    end if;
  end loop;
  -- Container/list checks prevent malformed persisted AI responses from breaking array rendering.
  if payload ? 'analysis' then
    item:=payload->'analysis';
    if jsonb_typeof(item->'scores') is distinct from 'object'
       or jsonb_typeof(item->'strengths') is distinct from 'array'
       or jsonb_typeof(item->'gaps') is distinct from 'array'
       or jsonb_typeof(item->'reason') is distinct from 'string'
       or jsonb_typeof(item->'nextAction') is distinct from 'string'
       or jsonb_typeof(item->'overall') is distinct from 'number' then
      raise exception using errcode='23514',message='Invalid match analysis structure';
    end if;
    if (item->>'overall')::numeric not between 0 and 100 or mod((item->>'overall')::numeric,1)<>0 then
      raise exception using errcode='23514',message='Invalid overall match score';
    end if;
    for entry in select * from jsonb_each(item->'scores') loop
      if entry.key not in ('Skills','Experience','Education','Keywords') then
        raise exception using errcode='23514',message='Invalid match score category';
      end if;
      if entry.value<>'null'::jsonb then
        if jsonb_typeof(entry.value) is distinct from 'number' then raise exception using errcode='23514',message='Invalid match score'; end if;
        if (entry.value::text)::numeric not between 0 and 100 or mod((entry.value::text)::numeric,1)<>0 then raise exception using errcode='23514',message='Invalid match score'; end if;
      end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(item->'strengths') e(v) where jsonb_typeof(v) is distinct from 'string') then
      raise exception using errcode='23514',message='Invalid match strengths';
    end if;
    if exists(select 1 from jsonb_array_elements(item->'gaps') e(v) where jsonb_typeof(v) is distinct from 'object'
      or jsonb_typeof(v->'item') is distinct from 'string' or jsonb_typeof(v->'kind') is distinct from 'string'
      or v->>'kind' not in ('not mentioned','preferred','missing evidence')) then
      raise exception using errcode='23514',message='Invalid match gaps';
    end if;
  end if;
  if payload ? 'tailoring' then
    if jsonb_typeof(payload#>'{tailoring,suggestions}') is distinct from 'array' then
      raise exception using errcode='23514',message='Invalid tailoring suggestions';
    end if;
    if exists(select 1 from jsonb_array_elements(payload#>'{tailoring,suggestions}') e(v)
      where jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'original') is distinct from 'string'
        or jsonb_typeof(v->'suggested') is distinct from 'string' or jsonb_typeof(v->'why') is distinct from 'string'
        or (v ? 'state' and (jsonb_typeof(v->'state') is distinct from 'string' or v->>'state' not in ('Accepted','Dismissed')))) then
      raise exception using errcode='23514',message='Invalid tailoring suggestion';
    end if;
  end if;
  if payload ? 'prep' then
    foreach key in array array['priorities','themes','technicalTopics','stories','questions','concerns'] loop
      if jsonb_typeof(payload->'prep'->key) is distinct from 'array' then
        raise exception using errcode='23514',message='Invalid preparation list';
      end if;
      if exists(select 1 from jsonb_array_elements(payload->'prep'->key) e(v) where jsonb_typeof(v) is distinct from 'string') then
        raise exception using errcode='23514',message='Invalid preparation text';
      end if;
    end loop;
  end if;
end $$;

create or replace function public.applypilot_activity() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare events jsonb; changes jsonb := '[]'::jsonb;
begin
  -- MATCH SIMPLE foreign keys alone skip validation if either referencing column is NULL.
  if new.resume_id is not null and new.user_id is null then
    raise exception using errcode='23514',message='A selected resume requires an application owner';
  end if;
  perform public.applypilot_validate_workspace(new.v2_data);
  if tg_op='INSERT' then
    events:='[]'::jsonb; -- clients cannot seed invented activity history
    new.v2_version:=0;
    changes:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title','Application saved'));
  else
    if old.v2_version is null or old.v2_version<0 or old.v2_version=2147483647 then
      raise exception using errcode='23514',message='Invalid workspace version';
    end if;
    events:=public.applypilot_normalize_events(old.v2_data->'events');
    if new.status is distinct from old.status then changes:=changes || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'type','status_changed','status',new.status,'title','Status changed to '||new.status)); end if;
    if new.match is distinct from old.match then changes:=changes || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title','Match calculated: '||coalesce(new.match::text,'—')||'%')); end if;
    if new.resume_id is distinct from old.resume_id then
      changes:=changes || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title','Resume changed'));
      new.v2_data:=new.v2_data - 'analysis' - 'tailoring' - 'tailoredText' - 'prep';
    end if;
    if new.raw_text is distinct from old.raw_text then new.v2_data:=new.v2_data - 'analysis' - 'tailoring' - 'tailoredText' - 'prep'; end if;
    if new.deadline is distinct from old.deadline then changes:=changes || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title','Deadline updated')); end if;
    new.v2_version:=old.v2_version+1;
  end if;
  if new.v2_data ? 'pendingEvent' then
    changes:=changes || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title',new.v2_data->>'pendingEvent'));
  end if;
  new.v2_data:=jsonb_set(new.v2_data-'pendingEvent','{events}',events||changes);
  -- Enforce the stored size AFTER server-generated events, not merely the request size.
  perform public.applypilot_validate_workspace(new.v2_data);
  return new;
end $$;
drop trigger if exists applypilot_activity_trigger on public."Applications";
create trigger applypilot_activity_trigger before insert or update on public."Applications"
  for each row execute function public.applypilot_activity();

create or replace function public.set_default_resume(profile_id uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare owner_id uuid:=auth.uid();
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  -- Lock the target BEFORE clearing the old default. A concurrent delete must not leave no default.
  perform 1 from public.resume_profiles where id=profile_id and user_id=owner_id for update;
  if not found then raise exception using errcode='42501',message='Resume not found'; end if;
  update public.resume_profiles set is_default=false where user_id=owner_id and is_default and id<>profile_id;
  update public.resume_profiles set is_default=true where id=profile_id and user_id=owner_id and not is_default;
end $$;
revoke all on function public.set_default_resume(uuid) from public, anon;
grant execute on function public.set_default_resume(uuid) to authenticated;
-- Trigger helpers operate only on their arguments/NEW row; none bypass RLS.
revoke all on function public.applypilot_activity(), public.applypilot_resume_timestamp(),
  public.applypilot_validate_workspace(jsonb), public.applypilot_normalize_events(jsonb) from public, anon;
grant execute on function public.applypilot_activity(), public.applypilot_resume_timestamp(),
  public.applypilot_validate_workspace(jsonb), public.applypilot_normalize_events(jsonb) to authenticated;
commit;
