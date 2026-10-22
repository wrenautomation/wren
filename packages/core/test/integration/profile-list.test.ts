/**
 * `profile_list` (0325) stays exactly what the old per-row view computed, through inserts,
 * updates, deletes, merges and truncates on every table it reads. Synthetic rows only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const run = (q: ReturnType<typeof sql>) => pg.db.execute(q);
const rows = async <T>(q: ReturnType<typeof sql>) => (await run(q)) as unknown as T[];

/** The old `profile_records` body: one subquery per column per row. */
const OLD = sql.raw(`
  select p.id, coalesce(p.name, (select k.value from profile_keys k where k.profile_id = p.id
      order by k.kind <> 'email', k.kind <> 'phone', k.id limit 1), '#' || p.id) "name",
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'email') emails,
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'phone') phones,
    (select string_agg(substr(k.kind, 8) || ' ' || k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind like 'handle:%') handles,
    (select string_agg(distinct case when k.kind = 'phone' then 'sms'
        when k.kind like 'handle:%' then substr(k.kind, 8) else k.kind end, ', ')
      from profile_keys k where k.profile_id = p.id and (k.kind in ('email', 'phone')
        or k.kind like 'handle:%')) channels,
    (select string_agg(distinct x.said, ', ') from (
      select c.channel || ' ' || c.state said from profile_keys k
        join consents c on c.address = k.value
          and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
        where k.profile_id = p.id and k.kind in ('email', 'phone')
      union all
      select 'sms opted out' from profile_keys k join sms_contacts s on s.e164 = k.value
        where k.profile_id = p.id and k.kind = 'phone' and s.state = 'opted_out') x) consent,
    p.first_seen, p.last_seen,
    (select count(*)::int from profile_keys k where k.profile_id = p.id) keys,
    (select count(*)::int from profile_traits t where t.profile_id = p.id) traits,
    (select count(*)::int from profile_merges m where m.into_id = p.id) merged,
    coalesce(r.stage, 'stranger') stage, coalesce(r.warmth, 'cold') warmth, r.why, r.warmth_line,
    r.warm_since, coalesce(r.persona, 'unknown') persona,
    coalesce(r.persona_role, 'unknown') persona_role,
    coalesce(r.persona_niche, 'unknown') persona_niche,
    coalesce(r.persona_size, 'unknown') persona_size, r.subscriptions,
    coalesce(r.replied_n, 0) replies, r.replied_last, r.replied_last_channel replied_channel,
    r.first_channel, r.last_touch_at, r.last_channel, r.came_from,
    (select t.value #>> '{}' from profile_traits t
      where t.profile_id = p.id and t.key = 'lead') lead
  from profiles p
  left join profile_rollups r on r.profile_id = p.id
  where p.merged_into is null`);

/** Rows the list and the old view disagree on, either way. */
async function drift(): Promise<unknown[]> {
  return rows(sql`
    (select 'old' side, * from (${OLD}) o except select 'old', * from profile_records)
    union all
    (select 'list', * from profile_records except select 'list', * from (${OLD}) o)`);
}

describe("profile list", () => {
  it("tracks every change to the tables it reads", async () => {
    const [a, b] = await rows<{ id: number }>(sql`
      insert into profiles (name) values (null), ('Bea') returning id`);
    const [ida, idb] = [a?.id, b?.id];
    expect(await drift()).toEqual([]);

    await run(sql`
      insert into profile_keys (profile_id, kind, value, source) values
        (${ida}, 'handle:x', 'ann_x', 'test'), (${ida}, 'phone', '+15550001111', 'test'),
        (${ida}, 'email', 'ann@list.example', 'test'), (${ida}, 'visitor', 'v1', 'test'),
        (${idb}, 'email', 'bea@list.example', 'test')`);
    await run(sql`
      insert into profile_traits (profile_id, key, value, source) values
        (${ida}, 'lead', '"lead"', 'test'), (${ida}, 'city', '"Austin"', 'test')`);
    expect(await drift()).toEqual([]);

    const [topic] = await rows<{ id: number }>(sql`
      insert into topics (name, public_name, line, channel, cadence)
      values ('list', 'List', 'x', 'email', 'weekly') returning id`);
    await run(sql`
      insert into consents (channel, address, topic_id, state, source, text_version)
      values ('email', 'ann@list.example', ${topic?.id}, 'confirmed', 'lander_form', 'v1')`);
    await run(sql`
      insert into sms_contacts (e164, source_kind, basis, state)
      values ('+15550001111', 'manual', 'opt_in', 'opted_out')`);
    await run(sql`
      insert into profile_rollups (profile_id, stage, warmth, persona, persona_role, persona_niche,
        persona_size, replied_n, last_touch_at)
      values (${ida}, 'replied', 'warm', 'recruiting owner', 'owner', 'recruiting', 'small', 2, now())`);
    expect(await drift()).toEqual([]);
    const [ann] = await rows<{ name: string; consent: string; channels: string }>(sql`
      select name, consent, channels from profile_records where id = ${ida}`);
    expect(ann).toEqual({
      name: "ann@list.example",
      consent: "email confirmed, sms opted out",
      channels: "email, sms, x",
    });

    await run(sql`update consents set state = 'withdrawn'`);
    await run(sql`update profile_rollups set warmth = 'hot', replied_n = 3`);
    await run(sql`update profile_traits set value = '"not_lead"' where key = 'lead'`);
    expect(await drift()).toEqual([]);

    // Bea merges into Ann: her keys move, she leaves the list.
    await run(sql`update profile_keys set profile_id = ${ida} where profile_id = ${idb}`);
    await run(sql`update profiles set merged_into = ${ida} where id = ${idb}`);
    await run(sql`
      insert into profile_merges (into_id, from_id, by, keys, traits, source)
      values (${ida}, ${idb}, 'test', 1, 0, 'test')`);
    expect(await drift()).toEqual([]);
    expect(await rows(sql`select 1 from profile_list where profile_id = ${idb}`)).toEqual([]);

    await run(sql`delete from profile_keys where kind = 'email' and value = 'ann@list.example'`);
    await run(sql`delete from profile_rollups`);
    await run(sql`truncate sms_contacts cascade`);
    expect(await drift()).toEqual([]);
  });
});
