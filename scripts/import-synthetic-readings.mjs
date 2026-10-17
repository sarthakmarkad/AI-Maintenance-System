// Trusted local administration only. No HTTP listener or alternative web identity.
// The caller must verify the supplied Auth UUID, as with db:provision.
import "dotenv/config";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Database } from "../apps/api/dist/database.js";
import { PrismaRepository } from "../apps/api/dist/repository.js";
import { ReadingsService } from "../apps/api/dist/readings/service.js";
import { parseConfig } from "../apps/api/dist/config.js";
const [userId, workbook, ...options] = process.argv.slice(2);
if (
  !z.string().uuid().safeParse(userId).success ||
  !workbook ||
  options.some((v) => !["--commit", "--acknowledge-synthetic"].includes(v))
)
  throw new Error(
    "Usage: npm run demo:readings -- <verified-Auth-user-UUID> <synthetic-workbook.xlsx> [--commit --acknowledge-synthetic]. Preview is the default.",
  );
if (
  options.includes("--commit") &&
  !options.includes("--acknowledge-synthetic")
)
  throw new Error("Commit requires explicit --acknowledge-synthetic.");
const db = new Database(parseConfig(process.env));
try {
  const file = path.resolve(workbook),
    info = await stat(file);
  if (!info.isFile() || info.size > 8 * 1024 * 1024)
    throw new Error("Choose a synthetic XLSX up to 8 MB.");
  const repo = new PrismaRepository(db),
    user = await repo.principal(userId);
  if (!user)
    throw new Error(
      "Verified user must have an active application membership.",
    );
  const service = new ReadingsService(db, repo);
  const preview = await service.preview(
    user,
    "WH-C",
    await readFile(file),
    path.basename(file),
    "LOCAL_CLI",
  );
  const eligible = preview.rows.filter((r) => r.eligible).length;
  console.log(
    JSON.stringify(
      {
        previewId: preview.id,
        source: preview.source,
        sourceRows: preview.rows.length,
        eligible,
        excluded: preview.rows.length - eligible,
        workbookHash: preview.workbookHash,
        warnings: preview.warnings,
      },
      null,
      2,
    ),
  );
  if (options.includes("--commit")) {
    if (!eligible)
      console.log(
        "Nothing new to import; existing observations were preserved.",
      );
    else
      console.log(
        JSON.stringify(
          await service.commit(user, "WH-C", preview.id, "LOCAL_CLI"),
          null,
          2,
        ),
      );
  }
} catch (e) {
  console.error(
    e instanceof Error && !("code" in e)
      ? e.message
      : "Reading import failed. Check local configuration.",
  );
  process.exitCode = 1;
} finally {
  await db.onModuleDestroy();
}
