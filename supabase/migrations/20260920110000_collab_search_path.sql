-- Supabase installs pgcrypto into the `extensions` schema, not `public`.
--
-- The two functions that hash and check the join code pin
-- `search_path = public` for safety, which also hid `crypt` and `gen_salt` —
-- so creating a workspace died on "function gen_salt(unknown) does not exist".
-- Adding `extensions` to the path keeps the pinning (still no user-controlled
-- schema in there) while letting these two find the functions they need.

create or replace function collab_auth(p_workspace uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
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
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  insert into collab_workspaces (name, repo, code_hash)
  values (p_name, p_repo, crypt(p_code, gen_salt('bf')))
  returning id into v_id;
  insert into collab_members (workspace_id, user_id, name, role)
  values (v_id, p_user, p_user_name, 'owner');
  return v_id;
end $$;

revoke execute on function collab_auth(uuid,text) from anon, authenticated;
grant execute on function collab_create_workspace(text,text,text,text,text) to anon, authenticated;
