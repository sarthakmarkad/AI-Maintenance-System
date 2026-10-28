// Read-only operational persistence audit. No row contents, credentials or tokens are exported.
import "dotenv/config";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { Prisma } = require("@prisma/client");
const { postgresClient } = require("../apps/api/dist/postgres");
if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL first.");
const db = postgresClient(process.env.DATABASE_URL);
const result = {
  at: new Date().toISOString(),
  readOnly: true,
  checks: [],
  tables: {},
  failures: [],
};
const ident = (name) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new Error("Unexpected database identifier.");
  return '"' + name + '"';
};
const check = (name, passed, detail) => {
  result.checks.push({
    name,
    passed,
    ...(detail === undefined ? {} : { detail }),
  });
  if (!passed) result.failures.push(name);
};
try {
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
      const migrations = await tx.$queryRawUnsafe(
        "SELECT migration_name,checksum,finished_at,rolled_back_at FROM maintenance._prisma_migrations ORDER BY migration_name",
      );
      let matching = true;
      for (const m of migrations) {
        if (!m.finished_at || m.rolled_back_at) {
          matching = false;
          continue;
        }
        const sql = await readFile(
          "prisma/migrations/" + m.migration_name + "/migration.sql",
        );
        if (createHash("sha256").update(sql).digest("hex") !== m.checksum)
          matching = false;
      }
      check("Completed migrations match retained SQL", matching, {
        count: migrations.length,
      });
      const tables = await tx.$queryRawUnsafe(
        "SELECT tablename::text AS name FROM pg_tables WHERE schemaname='maintenance' ORDER BY tablename",
      );
      for (const { name } of tables) {
        const rows = await tx.$queryRawUnsafe(
          "SELECT count(*)::text AS count FROM maintenance." + ident(name),
        );
        result.tables[name] = Number(rows[0].count);
      }
      const invalid = await tx.$queryRawUnsafe(
        "SELECT count(*)::text AS count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='maintenance' AND NOT c.convalidated",
      );
      check(
        "All declared constraints are validated",
        Number(invalid[0].count) === 0,
      );
      const brokenIndexes = await tx.$queryRawUnsafe(
        "SELECT count(*)::text AS count FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='maintenance' AND (NOT i.indisvalid OR NOT i.indisready)",
      );
      check(
        "All indexes are ready and valid",
        Number(brokenIndexes[0].count) === 0,
      );
      const foreignKeys = await tx.$queryRawUnsafe(`
      SELECT c.conname::text AS name,t.relname::text AS source,r.relname::text AS target,
        array_agg(a.attname::text ORDER BY k.ordinality) AS columns,
        array_agg(b.attname::text ORDER BY k.ordinality) AS "targetColumns"
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_namespace rn ON rn.oid=r.relnamespace
      CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(source,target,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.source
      JOIN pg_attribute b ON b.attrelid=r.oid AND b.attnum=k.target
      WHERE c.contype='f' AND n.nspname='maintenance' AND rn.nspname='maintenance'
      GROUP BY c.oid,c.conname,t.relname,r.relname`);
      let orphaned = 0;
      for (const fk of foreignKeys) {
        const nonnull = fk.columns
          .map((c) => "s." + ident(c) + " IS NOT NULL")
          .join(" AND ");
        const joined = fk.columns
          .map((c, i) => "s." + ident(c) + "=r." + ident(fk.targetColumns[i]))
          .join(" AND ");
        const rows = await tx.$queryRawUnsafe(
          "SELECT count(*)::text AS count FROM maintenance." +
            ident(fk.source) +
            " s WHERE " +
            nonnull +
            " AND NOT EXISTS (SELECT 1 FROM maintenance." +
            ident(fk.target) +
            " r WHERE " +
            joined +
            ")",
        );
        orphaned += Number(rows[0].count);
      }
      check("Foreign-key links have no orphaned records", orphaned === 0, {
        foreignKeys: foreignKeys.length,
        orphans: orphaned,
      });
      const uniqueIndexes = await tx.$queryRawUnsafe(`
      SELECT t.relname::text AS "tableName",array_agg(a.attname::text ORDER BY k.ordinality) AS columns
      FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
      WHERE n.nspname='maintenance' AND i.indisunique AND i.indisvalid AND i.indexprs IS NULL AND i.indpred IS NULL AND k.ordinality<=i.indnkeyatts
      GROUP BY i.indexrelid,t.relname`);
      const columns = await tx.$queryRawUnsafe(
        "SELECT table_name::text AS \"table\",column_name::text AS name,is_nullable::text AS nullable FROM information_schema.columns WHERE table_schema='maintenance'",
      );
      const missingUnique = [],
        missingColumns = [];
      for (const model of Prisma.dmmf.datamodel.models) {
        const selectors = [
          ...model.uniqueFields,
          ...(model.primaryKey ? [model.primaryKey.fields] : []),
          ...model.fields
            .filter((f) => f.isUnique || f.isId)
            .map((f) => [f.name]),
        ];
        for (const fields of selectors) {
          const names = fields.map(
            (name) => model.fields.find((f) => f.name === name)?.dbName ?? name,
          );
          if (
            !uniqueIndexes.some(
              (i) =>
                i.tableName === (model.dbName ?? model.name) &&
                JSON.stringify(i.columns) === JSON.stringify(names),
            )
          )
            missingUnique.push(model.name + "(" + fields.join(",") + ")");
        }
        for (const field of model.fields.filter((f) => f.kind !== "object")) {
          const column = columns.find(
            (c) =>
              c.table === (model.dbName ?? model.name) &&
              c.name === (field.dbName ?? field.name),
          );
          if (!column || (column.nullable === "NO") !== field.isRequired)
            missingColumns.push(model.name + "." + field.name);
        }
      }
      check(
        "Prisma unique selectors match database indexes",
        missingUnique.length === 0,
        missingUnique,
      );
      check(
        "Prisma scalar fields match stored columns and nullability",
        missingColumns.length === 0,
        missingColumns,
      );
      const zero = async (name, sql) => {
        const rows = await tx.$queryRawUnsafe(sql);
        check(name, Number(rows[0].count) === 0, {
          violations: Number(rows[0].count),
        });
      };
      await zero(
        "Staff actions retain matching immutable audit",
        `SELECT count(*)::text AS count FROM maintenance."TeamAction" t WHERE NOT EXISTS(SELECT 1 FROM maintenance."AuditEvent" a WHERE a."orgId"=t."orgId" AND a."actorId"=t."actorId" AND a."entityId"=t."targetId"::text AND a.action='TEAM_'||t.action AND a.detail->>'requestId'=t."requestId"::text)`,
      );
      await zero(
        "Accepted staff invitations retain the matching identity and audit",
        `SELECT count(*)::text AS count FROM maintenance."TeamInvitation" i WHERE i.status='ACCEPTED' AND (NOT EXISTS(SELECT 1 FROM maintenance."Membership" m WHERE m."orgId"=i."orgId" AND m."userId"=i."acceptedBy") OR NOT EXISTS(SELECT 1 FROM maintenance."AuditEvent" a WHERE a."orgId"=i."orgId" AND a."entityId"=i.id::text AND a.action='TEAM_INVITATION_ACCEPTED'))`,
      );
      await zero(
        "Work-order versions have complete retained event history",
        `SELECT count(*)::text AS count FROM maintenance."WorkOrder" w WHERE w.version<>(SELECT count(*) FROM maintenance."WorkOrderEvent" e WHERE e."orderId"=w.id) OR w.version<>(SELECT COALESCE(max(version),0) FROM maintenance."WorkOrderEvent" e WHERE e."orderId"=w.id)`,
      );
      await zero(
        "Work-order events have matching protected audit",
        `SELECT count(*)::text AS count FROM maintenance."WorkOrderEvent" e WHERE NOT EXISTS(SELECT 1 FROM maintenance."AuditEvent" a WHERE a."orgId"=e."orgId" AND a."entityId"=e."orderId"::text AND a."actorId"=e."actorId" AND a.action='WORK_ORDER_'||e.action AND a.detail->>'version'=e.version::text)`,
      );
      await zero(
        "Archived machines have no unresolved work or schedules",
        `SELECT count(*)::text AS count FROM maintenance."Machine" m WHERE m."archivedAt" IS NOT NULL AND (EXISTS(SELECT 1 FROM maintenance."WorkOrder" w WHERE w."machineId"=m.id AND w.status NOT IN('CLOSED','CANCELLED')) OR EXISTS(SELECT 1 FROM maintenance."MaintenancePlan" p WHERE p."machineId"=m.id AND p.active))`,
      );
      await zero(
        "Production rows reconcile to saved daily production",
        `SELECT count(*)::text AS count FROM maintenance."ProductionDay" d WHERE abs(d."productionKg"-(SELECT COALESCE(sum(r."productionKg"),0) FROM maintenance."ProductionRow" r WHERE r."dayId"=d.id))>0.01 OR abs(d."productionKg"-d."controlProductionKg")>0.01 OR abs(d."scrapKg"-d."controlScrapKg")>0.01`,
      );
      await zero(
        "Saved production belongs to committed imports",
        `SELECT count(*)::text AS count FROM maintenance."ProductionDay" d JOIN maintenance."ProductionImport" i ON i.id=d."importId" WHERE i.status<>'COMMITTED'`,
      );
      await zero(
        "Process readings retain synthetic committed provenance",
        `SELECT count(*)::text AS count FROM maintenance."ProcessReading" r JOIN maintenance."ReadingImport" i ON i.id=r."importId" WHERE r.source<>'SYNTHETIC' OR i.status<>'COMMITTED' OR EXTRACT(MINUTE FROM r."measuredAt" AT TIME ZONE 'Asia/Kolkata')<>0 OR EXTRACT(SECOND FROM r."measuredAt" AT TIME ZONE 'Asia/Kolkata')<>0`,
      );
      for (const table of [
        "WorkOrderAttachment",
        "MachineDocumentFile",
        "MachinePhoto",
      ])
        await zero(
          table + " stored bytes match retained size/hash",
          "SELECT count(*)::text AS count FROM maintenance." +
            ident(table) +
            ' WHERE octet_length(content)<>"byteSize" OR encode(sha256(content),\'hex\')<>"sha256"',
        );
      await zero(
        "Document versions have complete immutable event history",
        `SELECT count(*)::text AS count FROM maintenance."MachineDocument" d WHERE d.version<>(SELECT count(*) FROM maintenance."MachineDocumentEvent" e WHERE e."documentId"=d.id)`,
      );
      await zero(
        "Saved conversations retain every versioned turn",
        `SELECT count(*)::text AS count FROM maintenance."DocumentChat" c WHERE c.version<>(SELECT count(*) FROM maintenance."DocumentChatTurn" t WHERE t."chatId"=c.id) OR c.version<>(SELECT COALESCE(max(ordinal),0) FROM maintenance."DocumentChatTurn" t WHERE t."chatId"=c.id)`,
      );
      await zero(
        "Removed conversations have no later appended turns",
        `SELECT count(*)::text AS count FROM maintenance."DocumentChatTurn" t JOIN maintenance."DocumentChatArchive" a ON a."chatId"=t."chatId" WHERE t.at>a.at`,
      );
      await zero(
        "Ready RAG indexes retain complete source-matched chunks",
        `SELECT count(*)::text AS count FROM maintenance."DocumentRagIndex" i JOIN maintenance."MachineDocumentFile" f ON f.id=i."fileId" WHERE i.status='READY' AND (i."sourceHash"<>f.sha256 OR i."chunkCount"<>(SELECT count(*) FROM maintenance."DocumentRagChunk" c WHERE c."indexId"=i.id))`,
      );
      const vector = await tx.$queryRawUnsafe(
        "SELECT n.nspname::text AS name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'",
      );
      check("pgvector extension is available", vector.length === 1);
      if (vector.length)
        await zero(
          "Stored vectors retain the 1536-dimension storage contract",
          'SELECT count(*)::text AS count FROM maintenance."DocumentRagChunk" WHERE ' +
            ident(vector[0].name) +
            ".vector_dims(embedding)<>1536",
        );
      const browser = await tx.$queryRawUnsafe(
        "SELECT rolname::text AS role,has_schema_privilege(oid,'maintenance','USAGE') AS usage FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')",
      );
      check(
        "Browser/service roles cannot access the private operational schema",
        browser.length === 3 && browser.every((r) => !r.usage),
      );
      const grants = await tx.$queryRawUnsafe(`SELECT
      has_table_privilege(current_user,'maintenance."MembershipRoleGrant"','INSERT') AS roles,
      has_column_privilege(current_user,'maintenance."Machine"','code','UPDATE') AS codes,
      has_table_privilege(current_user,'maintenance."AuditEvent"','DELETE') AS audit,
      has_table_privilege(current_user,'maintenance."WorkOrderEvent"','UPDATE') AS history,
      has_table_privilege(current_user,'maintenance."ProductionRow"','DELETE') AS production`);
      check(
        "Runtime cannot mutate protected identity/source/audit evidence",
        Object.values(grants[0]).every((v) => v === false),
      );
      result.foreignKeys = foreignKeys.length;
    },
    { isolationLevel: "RepeatableRead", timeout: 120000 },
  );
} catch (error) {
  result.failures.push(
    "Audit execution failed: " +
      (error instanceof Error ? error.name : "Unknown"),
  );
} finally {
  await db.$disconnect();
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/database-audit.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify(
    {
      readOnly: true,
      checks: result.checks.length,
      tables: Object.keys(result.tables).length,
      foreignKeys: result.foreignKeys,
      failures: result.failures,
    },
    null,
    2,
  ),
);
if (result.failures.length) process.exitCode = 1;
