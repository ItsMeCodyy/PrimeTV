import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const PA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  PB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("database RLS isolates accounts, binds history to owned profiles and enforces the five-profile limit", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; insert into auth.users values ('${A}'),('${B}');`,
    );
    await db.exec(
      await readFile(new URL("../database/setup.sql", import.meta.url), "utf8"),
    );
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${A}';`);
    await db.query(
      "insert into primetv_profiles(id,user_id,name,slot) values ($1,$2,$3,1)",
      [PA, A, "A"],
    );
    await db.query(
      "insert into primetv_activity(profile_id,user_id,media_type,media_id,item) values ($1,$2,'movie',1,'{}')",
      [PA, A],
    );
    await db.exec(`set request.jwt.claim.sub='${B}';`);
    assert.equal(
      (await db.query("select * from primetv_profiles")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from primetv_activity")).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into primetv_profiles(user_id,name,slot) values ($1,'Intruder',2)",
          [A],
        ),
      /row-level security/,
    );
    await db.query(
      "insert into primetv_profiles(id,user_id,name,slot) values ($1,$2,$3,1)",
      [PB, B, "B"],
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into primetv_activity(profile_id,user_id,media_type,media_id,item) values ($1,$2,'movie',2,'{}')",
          [PA, B],
        ),
      /foreign key/,
    );
    assert.equal(
      (
        await db.query(
          "update primetv_activity set rating=1 where profile_id=$1 returning *",
          [PA],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        db.query("update primetv_profiles set user_id=$1 where id=$2", [A, PB]),
      /row-level security/,
    );
    for (let slot = 2; slot <= 5; slot++)
      await db.query(
        "insert into primetv_profiles(user_id,name,slot) values ($1,$2,$3)",
        [B, `B${slot}`, slot],
      );
    await assert.rejects(
      () =>
        db.query(
          "insert into primetv_profiles(user_id,name,slot) values ($1,'Sixth',6)",
          [B],
        ),
      /check constraint/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into primetv_profiles(user_id,name,slot) values ($1,'Duplicate',5)",
          [B],
        ),
      /unique constraint/,
    );
    await db.exec(`set request.jwt.claim.sub='${A}';`);
    await db.query("delete from primetv_profiles where id=$1", [PA]);
    assert.equal(
      (await db.query("select * from primetv_activity")).rows.length,
      0,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      () => db.query("select * from primetv_profiles"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
