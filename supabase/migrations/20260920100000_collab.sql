-- Slates collaboration: shared sessions, per-person lanes, one visible sponsor.
--
-- Modelled on how Amoeba splits a shared session (useamoeba.com/docs): a
-- workspace is one repo and its people; a session is one task, one branch, one
-- plan; each person works it in their own lane under their own login; and
-- every turn has exactly one visible sponsor so nothing ever quietly spends a
-- teammate's subscription.
--
-- SECURITY MODEL: the tables deny anon access outright. Everything goes
-- through the SECURITY DEFINER functions at the bottom, each of which demands
-- the workspace's join code before it will read or write anything. That way
-- the shipped anon key is not on its own enough to read anyone's sessions —
-- you also need the workspace id and its code.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────── workspaces

create table if not exists collab_workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Git remote, so two checkouts of the same repo find the same workspace.
  repo        text,
  -- Hashed, never stored in the clear; see collab_auth().
  code_hash   text not null,
  created_at  timestamptz not null default now()
);

create table if not exists collab_members (
  workspace_id uuid not null references collab_workspaces(id) on delete cascade,
  user_id      text not null,
  name         text not null,
  role         text not null default 'member' check (role in ('owner','member','viewer')),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ───────────────────────────────────────────────────────────────── sessions

create table if not exists collab_sessions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references collab_workspaces(id) on delete cascade,
  -- The local session id, so a client can map its own transcript onto this.
  local_id     text,
  task         text not null,
  branch       text,
  status       text not null default 'live' check (status in ('live','done')),
  -- Whose account the next turn spends. Exactly one, always.
  sponsor      text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists collab_sessions_workspace on collab_sessions(workspace_id, status);

-- One lane per person per session: their own conversation, their own provider.
create table if not exists collab_lanes (
  session_id  uuid not null references collab_sessions(id) on delete cascade,
  user_id     text not null,
  name        text not null,
  provider    text,
  -- Watching is a first-class mode; there is no invisible lurking.
  watching    boolean not null default false,
  last_seen   timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- ───────────────────────────────────────────────────── handoffs and the plan

create table if not exists collab_offers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references collab_sessions(id) on delete cascade,
  from_user   text not null,
  reason      text not null,
  -- Where the work had got to, so the next person resumes instead of restarting.
  at_step     text,
  created_at  timestamptz not null default now(),
  accepted_by text,
  accepted_at timestamptz
);

create index if not exists collab_offers_open on collab_offers(session_id) where accepted_at is null;

create table if not exists collab_steps (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references collab_sessions(id) on delete cascade,
  idx        int  not null,
  text       text not null,
  owner      text,
  status     text not null default 'todo' check (status in ('todo','doing','done')),
  unique (session_id, idx)
);

-- Advisory, session-scoped path claims behind the overlap warnings. Not a
-- filesystem lock: it tells a teammate someone is already in this file.
create table if not exists collab_claims (
  session_id uuid not null references collab_sessions(id) on delete cascade,
  path       text not null,
  user_id    text not null,
  claimed_at timestamptz not null default now(),
  primary key (session_id, path)
);

-- What one agent learns, every agent knows: short notes pinned to a file.
create table if not exists collab_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references collab_workspaces(id) on delete cascade,
  path         text,
  note         text not null,
  author       text not null,
  created_at   timestamptz not null default now()
);

create index if not exists collab_notes_path on collab_notes(workspace_id, path);

-- ────────────────────────────────────────────────────────────────────── RLS

alter table collab_workspaces enable row level security;
alter table collab_members    enable row level security;
alter table collab_sessions   enable row level security;
alter table collab_lanes      enable row level security;
alter table collab_offers     enable row level security;
alter table collab_steps      enable row level security;
alter table collab_claims     enable row level security;
alter table collab_notes      enable row level security;

-- Deliberately no policies: with RLS on and nothing granted, anon and
-- authenticated get nothing directly. The functions below are the only door.

-- ───────────────────────────────────────────────────────────────── functions

-- Verify a workspace's join code, or refuse. Every entry point starts here.
create or replace function collab_auth(p_workspace uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  select code_hash into v_hash from collab_workspaces where id = p_workspace;
  if v_hash is null then
    raise exception 'no such workspace';
  end if;
  if v_hash <> crypt(p_code, v_hash) then
    raise exception 'wrong join code';
  end if;
  return p_workspace;
end $$;

create or replace function collab_create_workspace(p_name text, p_repo text, p_code text,
                                                   p_user text, p_user_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into collab_workspaces (name, repo, code_hash)
  values (p_name, p_repo, crypt(p_code, gen_salt('bf')))
  returning id into v_id;
  insert into collab_members (workspace_id, user_id, name, role)
  values (v_id, p_user, p_user_name, 'owner');
  return v_id;
end $$;

create or replace function collab_join(p_workspace uuid, p_code text, p_user text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform collab_auth(p_workspace, p_code);
  insert into collab_members (workspace_id, user_id, name)
  values (p_workspace, p_user, p_name)
  on conflict (workspace_id, user_id) do update set name = excluded.name;
end $$;

-- Open a session, or re-find the one this local session already maps to.
create or replace function collab_open_session(p_workspace uuid, p_code text, p_local text,
                                               p_task text, p_branch text, p_user text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform collab_auth(p_workspace, p_code);
  select id into v_id from collab_sessions
   where workspace_id = p_workspace and local_id = p_local;
  if v_id is not null then
    return v_id;
  end if;
  insert into collab_sessions (workspace_id, local_id, task, branch, sponsor)
  values (p_workspace, p_local, p_task, p_branch, p_user)
  returning id into v_id;
  return v_id;
end $$;

-- Announce presence. Also the heartbeat: called on a timer, not just on entry.
create or replace function collab_heartbeat(p_workspace uuid, p_code text, p_session uuid,
                                            p_user text, p_name text, p_provider text,
                                            p_watching boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform collab_auth(p_workspace, p_code);
  insert into collab_lanes (session_id, user_id, name, provider, watching, last_seen)
  values (p_session, p_user, p_name, p_provider, coalesce(p_watching,false), now())
  on conflict (session_id, user_id) do update
    set name = excluded.name, provider = excluded.provider,
        watching = excluded.watching, last_seen = now();
end $$;

-- Offer the work. Note what this does NOT do: change the sponsor. Until
-- somebody accepts, the offering account is still the one paying.
create or replace function collab_offer(p_workspace uuid, p_code text, p_session uuid,
                                        p_user text, p_reason text, p_at_step text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform collab_auth(p_workspace, p_code);
  update collab_offers set accepted_at = now(), accepted_by = null
   where session_id = p_session and accepted_at is null;
  insert into collab_offers (session_id, from_user, reason, at_step)
  values (p_session, p_user, coalesce(nullif(p_reason,''), 'handing this over'), p_at_step);
  update collab_sessions set updated_at = now() where id = p_session;
end $$;

-- Accept a standing offer. This is the only path that moves the sponsor to
-- someone else, and it is always a deliberate act by the person taking it on.
create or replace function collab_accept(p_workspace uuid, p_code text, p_session uuid, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_offer collab_offers%rowtype;
begin
  perform collab_auth(p_workspace, p_code);
  select * into v_offer from collab_offers
   where session_id = p_session and accepted_at is null
   order by created_at desc limit 1;

  update collab_sessions set sponsor = p_user, updated_at = now() where id = p_session;

  if v_offer.id is null then
    return jsonb_build_object('claimed', true);
  end if;

  update collab_offers set accepted_by = p_user, accepted_at = now() where id = v_offer.id;
  return jsonb_build_object('claimed', false, 'from', v_offer.from_user,
                            'reason', v_offer.reason, 'at_step', v_offer.at_step);
end $$;

create or replace function collab_set_plan(p_workspace uuid, p_code text, p_session uuid, p_steps jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform collab_auth(p_workspace, p_code);
  delete from collab_steps where session_id = p_session;
  insert into collab_steps (session_id, idx, text, owner, status)
  select p_session, (ordinality - 1)::int,
         coalesce(e->>'text',''), nullif(e->>'owner',''), coalesce(e->>'status','todo')
    from jsonb_array_elements(p_steps) with ordinality as t(e, ordinality);
  update collab_sessions set updated_at = now() where id = p_session;
end $$;

create or replace function collab_own_step(p_workspace uuid, p_code text, p_session uuid,
                                           p_idx int, p_user text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform collab_auth(p_workspace, p_code);
  update collab_steps
     set owner = coalesce(p_user, owner), status = coalesce(nullif(p_status,''), status)
   where session_id = p_session and idx = p_idx;
end $$;

create or replace function collab_claim_path(p_workspace uuid, p_code text, p_session uuid,
                                             p_path text, p_user text)
returns text language plpgsql security definer set search_path = public as $$
declare v_holder text;
begin
  perform collab_auth(p_workspace, p_code);
  select user_id into v_holder from collab_claims
   where session_id = p_session and path = p_path;
  if v_holder is not null and v_holder <> p_user then
    return v_holder;              -- someone else is already in this file
  end if;
  insert into collab_claims (session_id, path, user_id)
  values (p_session, p_path, p_user)
  on conflict (session_id, path) do update set user_id = excluded.user_id, claimed_at = now();
  return null;
end $$;

create or replace function collab_note(p_workspace uuid, p_code text, p_path text,
                                       p_note text, p_author text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform collab_auth(p_workspace, p_code);
  insert into collab_notes (workspace_id, path, note, author)
  values (p_workspace, p_path, p_note, p_author);
end $$;

-- Everything a client needs to draw the session, in one round trip.
create or replace function collab_state(p_workspace uuid, p_code text, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform collab_auth(p_workspace, p_code);
  select jsonb_build_object(
    'session', (select to_jsonb(s) from collab_sessions s where s.id = p_session),
    'lanes',   coalesce((select jsonb_agg(to_jsonb(l) order by l.last_seen desc)
                           from collab_lanes l
                          where l.session_id = p_session
                            and l.last_seen > now() - interval '2 minutes'), '[]'::jsonb),
    'offer',   (select to_jsonb(o) from collab_offers o
                 where o.session_id = p_session and o.accepted_at is null
                 order by o.created_at desc limit 1),
    'steps',   coalesce((select jsonb_agg(to_jsonb(st) order by st.idx)
                           from collab_steps st where st.session_id = p_session), '[]'::jsonb),
    'claims',  coalesce((select jsonb_agg(to_jsonb(c)) from collab_claims c
                          where c.session_id = p_session), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- Mission Control: every live session in the workspace, with who is in it and
-- whose account the current turn is using.
create or replace function collab_board(p_workspace uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform collab_auth(p_workspace, p_code);
  select coalesce(jsonb_agg(row order by row->>'updated_at' desc), '[]'::jsonb) into v
    from (
      select jsonb_build_object(
        'id', s.id, 'task', s.task, 'branch', s.branch, 'status', s.status,
        'sponsor', s.sponsor, 'updated_at', s.updated_at,
        'present', coalesce((select jsonb_agg(l.name) from collab_lanes l
                              where l.session_id = s.id
                                and l.last_seen > now() - interval '2 minutes'), '[]'::jsonb),
        'offer', (select o.reason from collab_offers o
                   where o.session_id = s.id and o.accepted_at is null
                   order by o.created_at desc limit 1),
        'done', (select count(*) from collab_steps st where st.session_id = s.id and st.status = 'done'),
        'total', (select count(*) from collab_steps st where st.session_id = s.id)
      ) as row
      from collab_sessions s
      where s.workspace_id = p_workspace and s.status = 'live'
    ) t;
  return v;
end $$;

-- The functions are the API; the tables stay shut.
grant execute on function
  collab_create_workspace(text,text,text,text,text),
  collab_join(uuid,text,text,text),
  collab_open_session(uuid,text,text,text,text,text),
  collab_heartbeat(uuid,text,uuid,text,text,text,boolean),
  collab_offer(uuid,text,uuid,text,text,text),
  collab_accept(uuid,text,uuid,text),
  collab_set_plan(uuid,text,uuid,jsonb),
  collab_own_step(uuid,text,uuid,int,text,text),
  collab_claim_path(uuid,text,uuid,text,text),
  collab_note(uuid,text,text,text,text),
  collab_state(uuid,text,uuid),
  collab_board(uuid,text)
to anon, authenticated;

revoke execute on function collab_auth(uuid,text) from anon, authenticated;
