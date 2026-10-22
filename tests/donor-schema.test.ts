import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Db } from "@/db/client";
import { accounts } from "@/db/schema";
import { SKIP_DB_TESTS, testDb, truncateDonor } from "./support/db";

/**
 * The donor schema's two promises, read from the catalog of the migrated test
 * database rather than from schema.ts, so a hand-edited migration can't pass
 * (ADR-0027 §6): the stats survive every account deletion, and deletion is an
 * ordered procedure that no cascade can run ahead of.
 */

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

async function columnsOf(db: Db, table: string): Promise<string[]> {
  const result = await rows<{ column_name: string }>(
    db,
    sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = ${table} order by column_name`,
  );
  return result.map((r) => r.column_name);
}

type ForeignKey = { child: string; column: string; parent: string; on_delete: string };

async function foreignKeys(db: Db): Promise<ForeignKey[]> {
  return rows<ForeignKey>(
    db,
    sql`select c.conrelid::regclass::text as child, a.attname as column,
               c.confrelid::regclass::text as parent,
               case c.confdeltype when 'c' then 'cascade' when 'a' then 'no action'
                    when 'r' then 'restrict' when 'n' then 'set null' else 'set default' end as on_delete
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace`,
  );
}

describe.skipIf(SKIP_DB_TESTS)("ADR-0027 donor schema", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateDonor(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("donation_stats holds nothing that names a donor, so deletion never reaches it", async () => {
    expect(await columnsOf(db, "donation_stats")).toEqual([
      "amount",
      "animal_external_id",
      "animal_source",
      "currency",
      "donated_on",
      "frequency",
      "id",
      "nonprofit_slug",
    ]);
    const touching = (await foreignKeys(db)).filter(
      (fk) => fk.child === "donation_stats" || fk.parent === "donation_stats",
    );
    expect(touching).toEqual([]);
  });

  it("email_suppressions holds a keyed digest, never an address (ADR-0027 as amended 2026-10-22)", async () => {
    expect(await columnsOf(db, "email_suppressions")).toEqual(["created_at", "email_hmac", "reason"]);
  });

  it("every donor-owned row reaches its account through the intent, and none of those links cascades", async () => {
    const links = (await foreignKeys(db))
      .filter((fk) => ["donation_intents", "donations", "keepsake", "keepsake_fact"].includes(fk.child))
      .map((fk) => `${fk.child}.${fk.column} -> ${fk.parent} (${fk.on_delete})`)
      .sort();
    expect(links).toEqual([
      "donation_intents.account_id -> accounts (no action)",
      "donations.intent_id -> donation_intents (no action)",
      "donations.webhook_payload_id -> everyorg_webhook_payloads (no action)",
      "keepsake.donation_id -> donations (no action)",
      "keepsake_fact.keepsake_id -> keepsake (no action)",
    ]);
  });

  it("an email address is one account whatever its capitals", async () => {
    await db.insert(accounts).values({ email: "Pat@Example.org" });
    await expect(db.insert(accounts).values({ email: "pat@example.org" })).rejects.toThrow();
  });
});
