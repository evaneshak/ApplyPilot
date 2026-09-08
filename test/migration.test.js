import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await fs.readFile(
  new URL("../docs/migrations/001_applypilot_v2.sql", import.meta.url),
  "utf8",
);
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";
const setup = `
create schema auth; create role authenticated; create role anon;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table public."Resumes"(user_id uuid unique references auth.users(id),text text,updated_at timestamptz);
-- A numeric application ID deliberately verifies that the migration does not assume UUID IDs.
create table public."Applications"(id bigint generated always as identity primary key,user_id uuid references auth.users(id),company text,position text,status text,raw_text text,match integer,deadline text);
alter table public."Applications" enable row level security;
create policy owner on public."Applications" for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select,insert,update,delete on public."Applications" to authenticated;
insert into auth.users values('${U1}'),('${U2}'),('${U3}');
insert into public."Resumes" values('${U1}','Existing resume text','2026-01-02T03:04:05Z'),('${U2}',null,null);
insert into public."Applications"(user_id,company,position,status,raw_text,match,deadline) values
('${U1}','Legacy company','Engineer','applied','Original job',84,'2026-10-01'),
('${U1}','Second company','Engineer','saved','Second job',null,null),
('${U2}','Other company','Engineer','interview','Other job',77,null),
('${U3}','No resume company','Engineer','saved','No resume job',null,null),
('${U3}','Another opportunity','Engineer','saved','Another job',null,null);
-- Exercise broad Supabase-style default grants on tables created by the migration.
alter default privileges in schema public grant all on tables to authenticated,anon;
`;
async function fixture(t, { migrate = true } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(setup);
  if (migrate) await db.exec(migration);
  return db;
}
async function asUser(db, id = U1) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`);
}
async function owner(db) {
  await db.exec("reset role;");
}
async function rows(db, sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function profile(db, id = U1) {
  return (
    await rows(db, "select * from public.resume_profiles where user_id=$1", [
      id,
    ])
  )[0];
}
async function app(db, id = 1) {
  return (
    await rows(db, 'select * from public."Applications" where id=$1', [id])
  )[0];
}
async function reject(db, sql, params = [], code = "23514") {
  await assert.rejects(
    db.query(sql, params),
    (e) => (Array.isArray(code) ? code : [code]).includes(e.code),
    sql,
  );
}

test("migration preserves every legacy field, copies resumes, and handles no-resume users and multiple applications", async (t) => {
  const db = await fixture(t, { migrate: false });
  const oldApps = await rows(
    db,
    'select * from public."Applications" order by id',
  );
  const oldResumes = await rows(
    db,
    'select * from public."Resumes" order by user_id',
  );
  await db.exec(migration);
  assert.deepEqual(
    await rows(db, 'select * from public."Resumes" order by user_id'),
    oldResumes,
  );
  const next = await rows(
    db,
    'select * from public."Applications" order by id',
  );
  next.forEach((row, i) =>
    Object.keys(oldApps[i]).forEach((key) =>
      assert.deepEqual(row[key], oldApps[i][key]),
    ),
  );
  const p = await profile(db);
  assert.equal(p.title, "Primary Resume");
  assert.equal(p.text, "Existing resume text");
  assert.equal(p.is_default, true);
  assert.equal(
    new Date(p.updated_at).toISOString(),
    "2026-01-02T03:04:05.000Z",
  );
  assert.equal(next[0].resume_id, p.id);
  assert.equal(next[1].resume_id, p.id);
  assert.equal((await profile(db, U2)).text, "");
  assert.equal(await profile(db, U3), undefined);
  assert.equal(next[3].resume_id, null);
  assert.equal(next[4].resume_id, null);
  assert.deepEqual(next[0].v2_data, {});
  assert.equal(next[0].v2_version, 0);
});

test("repeat migration preserves edits, intentionally null assignments, deleted profiles, versions, and timestamps", async (t) => {
  const db = await fixture(t);
  const p = await profile(db);
  await db.query(
    'update public."Applications" set resume_id=null where user_id=$1',
    [U1],
  );
  await db.query("delete from public.resume_profiles where id=$1", [p.id]);
  await db.query("update public.resume_profiles set text=$1 where user_id=$2", [
    "Edited v2 resume",
    U2,
  ]);
  const before = {
    apps: await rows(db, 'select * from public."Applications" order by id'),
    profiles: await rows(
      db,
      "select * from public.resume_profiles order by id",
    ),
    receipt: await rows(db, "select * from public.applypilot_migration_state"),
  };
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(
    await rows(db, 'select * from public."Applications" order by id'),
    before.apps,
  );
  assert.deepEqual(
    await rows(db, "select * from public.resume_profiles order by id"),
    before.profiles,
  );
  assert.deepEqual(
    await rows(db, "select * from public.applypilot_migration_state"),
    before.receipt,
  );
  assert.equal(
    (
      await rows(
        db,
        "select count(*)::int n from pg_trigger where tgrelid='public.\"Applications\"'::regclass and tgname='applypilot_activity_trigger'",
      )
    )[0].n,
    1,
  );
});

test("profile RLS protects all operations, ownership changes, RPC and migration receipt even with a permissive policy", async (t) => {
  const db = await fixture(t);
  const mine = await profile(db);
  const theirs = await profile(db, U2);
  await db.exec(
    "create policy overly_broad on public.resume_profiles for all to authenticated using(true) with check(true);",
  );
  await asUser(db);
  assert.deepEqual(
    (await rows(db, "select id from public.resume_profiles")).map((r) => r.id),
    [mine.id],
  );
  await reject(
    db,
    "insert into public.resume_profiles(user_id,title)values($1,$2)",
    [U2, "Forbidden"],
    "42501",
  );
  assert.equal(
    (
      await rows(
        db,
        "update public.resume_profiles set title=$1 where id=$2 returning id",
        ["Forbidden", theirs.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await rows(
        db,
        "delete from public.resume_profiles where id=$1 returning id",
        [theirs.id],
      )
    ).length,
    0,
  );
  await reject(
    db,
    "update public.resume_profiles set user_id=$1 where id=$2",
    [U2, mine.id],
    "42501",
  );
  await reject(
    db,
    "select public.set_default_resume($1)",
    [theirs.id],
    "42501",
  );
  await reject(
    db,
    "select * from public.applypilot_migration_state",
    [],
    "42501",
  );
  await reject(db, "truncate public.resume_profiles cascade", [], "42501");
  await owner(db);
  await db.exec("set role anon;");
  await reject(db, "select * from public.resume_profiles", [], "42501");
  await reject(db, "select public.set_default_resume($1)", [mine.id], "42501");
  await asUser(db, "");
  await reject(db, "select public.set_default_resume($1)", [mine.id], "42501");
});

test("composite FK blocks cross-owner, missing, and null-owner assignments and referenced deletion", async (t) => {
  const db = await fixture(t);
  const mine = await profile(db);
  const theirs = await profile(db, U2);
  await asUser(db);
  await reject(
    db,
    'update public."Applications" set resume_id=$1 where id=1',
    [theirs.id],
    "23503",
  );
  await reject(
    db,
    'update public."Applications" set resume_id=$1 where id=1',
    [U3],
    "23503",
  );
  await reject(
    db,
    "delete from public.resume_profiles where id=$1",
    [mine.id],
    ["23503", "23001"],
  );
  await owner(db);
  await reject(
    db,
    'insert into public."Applications"(user_id,resume_id,status)values(null,$1,$2)',
    [mine.id, "saved"],
  );
  await reject(db, 'update public."Applications" set user_id=null where id=1');
  assert.equal((await app(db)).resume_id, mine.id);
});

test("default RPC, unique index, and server timestamps preserve invariants and roll back on failure", async (t) => {
  const db = await fixture(t);
  const first = await profile(db);
  await asUser(db);
  const second = (
    await rows(
      db,
      "insert into public.resume_profiles(user_id,title)values($1,$2) returning *",
      [U1, "Second"],
    )
  )[0];
  await reject(
    db,
    "insert into public.resume_profiles(user_id,title,is_default)values($1,$2,true)",
    [U1, "Duplicate default"],
    "23505",
  );
  await db.query("select public.set_default_resume($1)", [second.id]);
  assert.equal(
    (
      await rows(db, "select id from public.resume_profiles where is_default")
    )[0].id,
    second.id,
  );
  await reject(db, "select public.set_default_resume($1)", [U3], "42501");
  assert.equal(
    (
      await rows(db, "select id from public.resume_profiles where is_default")
    )[0].id,
    second.id,
  );
  const before = (
    await rows(
      db,
      "select updated_at from public.resume_profiles where id=$1",
      [second.id],
    )
  )[0].updated_at;
  await db.query("select public.set_default_resume($1)", [second.id]);
  assert.deepEqual(
    (
      await rows(
        db,
        "select updated_at from public.resume_profiles where id=$1",
        [second.id],
      )
    )[0].updated_at,
    before,
  );
  await db.query(
    "update public.resume_profiles set title='Renamed',updated_at='2000-01-01' where id=$1",
    [second.id],
  );
  assert.ok(
    new Date((await profile(db)).updated_at) > new Date(first.updated_at),
  );
  assert.ok(
    new Date(
      (
        await rows(
          db,
          "select updated_at from public.resume_profiles where id=$1",
          [second.id],
        )
      )[0].updated_at,
    ) > new Date("2026-01-01"),
  );
});

const event = {
  id: "legacy-event",
  title: "Existing history",
  at: "2026-09-07T12:00:00Z",
};
test("history normalization handles absent/null/single-object history and rejects corrupt values without erasing rows", async (t) => {
  const db = await fixture(t);
  for (const value of [null, [], event, [event]]) {
    await db.exec(
      'alter table public."Applications" disable trigger applypilot_activity_trigger',
    );
    await db.query('update public."Applications" set v2_data=$1 where id=1', [
      { events: value },
    ]);
    await db.exec(
      'alter table public."Applications" enable trigger applypilot_activity_trigger',
    );
    await db.query('update public."Applications" set v2_data=$1 where id=1', [
      { pendingEvent: "New note" },
    ]);
    const history = (await app(db)).v2_data.events;
    assert.ok(Array.isArray(history));
    assert.equal(history.at(-1).title, "New note");
    if (value === event || (Array.isArray(value) && value.length))
      assert.deepEqual(history[0], event);
  }
  for (const value of [
    "bad",
    42,
    true,
    {},
    [null],
    [event, 42],
    [{ title: "Bad date", at: "not-a-date" }],
  ]) {
    await db.exec(
      'alter table public."Applications" disable trigger applypilot_activity_trigger',
    );
    await db.query('update public."Applications" set v2_data=$1 where id=1', [
      { events: value },
    ]);
    await db.exec(
      'alter table public."Applications" enable trigger applypilot_activity_trigger',
    );
    const before = await app(db);
    await reject(db, 'update public."Applications" set v2_data=$1 where id=1', [
      { pendingEvent: "Must not corrupt history" },
    ]);
    assert.deepEqual(await app(db), before);
  }
});

test("trigger validates pending notes and frontend JSON structures and ignores attempted history replacement", async (t) => {
  const db = await fixture(t);
  const bad = [
    null,
    [],
    42,
    { pendingEvent: null },
    { pendingEvent: {} },
    { pendingEvent: [] },
    { pendingEvent: "" },
    { pendingEvent: "x".repeat(5001) },
    { events: [null] },
    { interviews: {} },
    { interviews: [null] },
    { reminders: "bad" },
    { reminders: [{ id: "r", title: "R", date: "bad", completed: false }] },
    {
      reminders: [{ id: "r", title: "R", date: event.at, completed: "false" }],
    },
    { answers: [] },
    { answers: { question: {} } },
    { tailoredText: [] },
    { analysis: [] },
    { analysis: { scores: [] } },
    { tailoring: { suggestions: [null] } },
    { prep: { priorities: "bad" } },
  ];
  for (const payload of bad)
    await reject(db, 'update public."Applications" set v2_data=$1 where id=1', [
      payload,
    ]);
  await db.query('update public."Applications" set v2_data=$1 where id=1', [
    { pendingEvent: "Preserve this" },
  ]);
  const old = await app(db);
  await db.query(
    'update public."Applications" set v2_data=$1,v2_version=100000 where id=1',
    [{ events: [event], pendingEvent: "Append only" }],
  );
  const after = await app(db);
  assert.deepEqual(after.v2_data.events.slice(0, -1), old.v2_data.events);
  assert.equal(after.v2_version, old.v2_version + 1);
  assert.equal(after.v2_data.pendingEvent, undefined);
});

test("frontend interview/reminder/prep/tailoring/match payloads persist and stale revisions are rejected", async (t) => {
  const db = await fixture(t);
  await asUser(db);
  const payload = {
    pendingEvent: "Workspace saved",
    interviews: [
      {
        id: "i",
        title: "Technical round",
        date: event.at,
        type: "Technical",
        status: "Upcoming",
        notes: "Prepare",
        completed: false,
        timezone: "America/Detroit",
      },
    ],
    reminders: [
      {
        id: "r",
        title: "Follow up",
        date: event.at,
        type: "Follow up",
        completed: false,
      },
    ],
    answers: { "Tell a story": "My actual experience" },
    tailoredText: "Built an API.",
    analysis: {
      overall: 85,
      scores: { Skills: 90, Experience: 80, Education: null, Keywords: 85 },
      strengths: ["React"],
      gaps: [{ item: "AWS", kind: "not mentioned" }],
      reason: "Evidence",
      nextAction: "Review",
      resumeUpdatedAt: event.at,
    },
    tailoring: {
      suggestions: [
        {
          original: "Built an API.",
          suggested: "Developed an API.",
          why: "Clearer",
          state: "Accepted",
        },
      ],
    },
    prep: {
      priorities: ["Reliability"],
      themes: [],
      technicalTopics: [],
      stories: [],
      questions: [],
      concerns: [],
    },
  };
  const before = await app(db);
  const updated = await rows(
    db,
    'update public."Applications" set v2_data=$1 where id=1 and v2_version=$2 returning *',
    [payload, before.v2_version],
  );
  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0].v2_data.interviews, payload.interviews);
  assert.equal(
    (
      await rows(
        db,
        'update public."Applications" set v2_data=$1 where id=1 and v2_version=$2 returning *',
        [payload, before.v2_version],
      )
    ).length,
    0,
  );
  await db.query(
    "update public.\"Applications\" set status='interview' where id=1",
  );
  assert.equal((await app(db)).v2_data.events.at(-1).type, "status_changed");
  await db.query(
    "update public.\"Applications\" set raw_text='Changed job' where id=1",
  );
  assert.equal((await app(db)).v2_data.analysis, undefined);
});

test("500000-byte bound checks actual stored INSERT/UPDATE JSON including generated events and multibyte text", async (t) => {
  const db = await fixture(t);
  // Input just below the limit is still rejected when the INSERT event pushes the stored value over.
  const base = { padding: "" };
  const baseSize = (
    await rows(db, "select octet_length($1::jsonb::text) n", [base])
  )[0].n;
  await reject(
    db,
    'insert into public."Applications"(user_id,status,v2_data)values($1,$2,$3)',
    [U1, "saved", { padding: "x".repeat(499999 - baseSize) }],
  );
  await reject(
    db,
    'insert into public."Applications"(user_id,status,v2_data)values($1,$2,$3)',
    [U1, "saved", { padding: "é".repeat(250000) }],
  );
  assert.equal(
    (await rows(db, 'select count(*)::int n from public."Applications"'))[0].n,
    5,
  );
  const payload = { padding: "", events: [] };
  const size = (
    await rows(db, "select octet_length($1::jsonb::text) n", [payload])
  )[0].n;
  payload.padding = "x".repeat(500000 - size);
  await db.query('update public."Applications" set v2_data=$1 where id=1', [
    payload,
  ]);
  assert.equal(
    (
      await rows(
        db,
        'select octet_length(v2_data::text) n from public."Applications" where id=1',
      )
    )[0].n,
    500000,
  );
  const before = await app(db);
  await reject(
    db,
    "update public.\"Applications\" set status='interview' where id=1",
  );
  await reject(db, 'update public."Applications" set v2_data=$1 where id=1', [
    { ...payload, padding: payload.padding + "x" },
  ]);
  assert.deepEqual(await app(db), before);
});

test("incompatible schema and oversized legacy content abort transactionally rather than losing data", async (t) => {
  const db = await fixture(t, { migrate: false });
  await db.query('update public."Resumes" set text=$1 where user_id=$2', [
    "x".repeat(100001),
    U1,
  ]);
  await assert.rejects(db.exec(migration));
  await db.exec("rollback");
  assert.equal(
    (await rows(db, "select to_regclass('public.resume_profiles') name"))[0]
      .name,
    null,
  );
  assert.equal(
    (
      await rows(
        db,
        'select length(text) n from public."Resumes" where user_id=$1',
        [U1],
      )
    )[0].n,
    100001,
  );
  await db.query('update public."Resumes" set text=$1 where user_id=$2', [
    "Restored fixture",
    U1,
  ]);
  await db.exec('alter table public."Applications" add column v2_version text');
  await assert.rejects(db.exec(migration), /Incompatible v2 schema/);
  await db.exec("rollback");
  assert.equal(
    (await rows(db, "select to_regclass('public.resume_profiles') name"))[0]
      .name,
    null,
  );
});

test("same-named foreign key on another table cannot prevent creation of the application ownership constraint", async (t) => {
  const db = await fixture(t, { migrate: false });
  await db.exec(
    "create table public.unrelated(id uuid, constraint applications_resume_owner_fk foreign key(id) references auth.users(id))",
  );
  await db.exec(migration);
  const other = await profile(db, U2);
  await reject(
    db,
    'update public."Applications" set resume_id=$1 where id=1',
    [other.id],
    "23503",
  );
});

test("repeat migration rejects drifted indexes, defaults, and profile constraints", async (t) => {
  const db = await fixture(t);
  for (const change of [
    "alter table public.resume_profiles alter column id drop default",
    "drop index public.resume_profiles_one_default; create index resume_profiles_one_default on public.resume_profiles(title)",
    "alter table public.resume_profiles drop constraint resume_profiles_text_check; alter table public.resume_profiles add constraint resume_profiles_text_check check(true)",
  ]) {
    await db.exec("begin");
    await db.exec(change);
    await db.exec("commit");
    await assert.rejects(db.exec(migration), /Incompatible/);
    await db.exec("rollback");
    if (change.includes("drop default"))
      await db.exec(
        "alter table public.resume_profiles alter column id set default gen_random_uuid()",
      );
    if (change.includes("drop index"))
      await db.exec(
        "drop index public.resume_profiles_one_default; create unique index resume_profiles_one_default on public.resume_profiles(user_id) where is_default",
      );
    if (change.includes("drop constraint"))
      await db.exec(
        "alter table public.resume_profiles drop constraint resume_profiles_text_check; alter table public.resume_profiles add constraint resume_profiles_text_check check(length(text)<=100000)",
      );
  }
});

test("an earlier unmarked or partial v2 installation is rejected without modifying its data", async (t) => {
  const db = await fixture(t, { migrate: false });
  await db.exec(
    `create table public.resume_profiles(id uuid primary key, text text); insert into public.resume_profiles values(gen_random_uuid(),'Keep this partial installation')`,
  );
  const before = await rows(db, "select * from public.resume_profiles");
  await assert.rejects(db.exec(migration), /Unmarked pre-existing v2 schema/);
  await db.exec("rollback");
  assert.deepEqual(
    await rows(db, "select * from public.resume_profiles"),
    before,
  );
});
