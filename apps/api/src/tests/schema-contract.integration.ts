// Read-only contract between generated Prisma metadata and the migrated test database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma, PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Schema verification requires an isolated *_test database.");

test("every Prisma unique selector is backed by a migrated unique index", async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const indexes = await db.$queryRaw<
      { tableName: string; columns: string[] }[]
    >`
      SELECT t.relname::text AS "tableName", array_agg(a.attname::text ORDER BY k.ordinality) AS columns
      FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
      WHERE n.nspname='maintenance' AND i.indisunique AND i.indisvalid AND i.indexprs IS NULL AND i.indpred IS NULL AND k.ordinality<=i.indnkeyatts
      GROUP BY i.indexrelid,t.relname`;
    const missing: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const selectors = [
        ...model.uniqueFields,
        ...(model.primaryKey ? [model.primaryKey.fields] : []),
        ...model.fields
          .filter((f) => f.isUnique || f.isId)
          .map((f) => [f.name]),
      ];
      for (const fields of selectors) {
        const columns = fields.map(
          (name) => model.fields.find((f) => f.name === name)?.dbName ?? name,
        );
        if (
          !indexes.some(
            (i) =>
              i.tableName === (model.dbName ?? model.name) &&
              JSON.stringify(i.columns) === JSON.stringify(columns),
          )
        )
          missing.push(`${model.name}(${fields.join(",")})`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      "Prisma declares uniqueness that migrations do not enforce",
    );
  } finally {
    await db.$disconnect();
  }
});
test("Prisma scalar column nullability matches the migrated database", async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const columns = await db.$queryRaw<
      { table: string; name: string; nullable: string }[]
    >`
      SELECT table_name::text AS "table",column_name::text AS name,is_nullable::text AS nullable
      FROM information_schema.columns WHERE table_schema='maintenance'`;
    const mismatched: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models)
      for (const field of model.fields.filter((f) => f.kind !== "object")) {
        const c = columns.find(
          (c) =>
            c.table === (model.dbName ?? model.name) &&
            c.name === (field.dbName ?? field.name),
        );
        if (!c || (c.nullable === "NO") !== field.isRequired)
          mismatched.push(model.name + "." + field.name);
      }
    assert.deepEqual(mismatched, []);
  } finally {
    await db.$disconnect();
  }
});
