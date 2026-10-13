import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { localParts } from "./time.ts";

const KEEP_DAYS = 14;
const BACKUP_RE = /^crm-\d{4}-\d{2}-\d{2}\.db$/;

const backupDir = (): string => join(dirname(config.dbPath), "backups");

/**
 * Consistent snapshot of the live database (safe while the server runs) into
 * backups/crm-YYYY-MM-DD.db, keeping the last 14. Photos are immutable files
 * in uploads/ and are not duplicated.
 */
export const runBackup = (): string | null => {
  if (config.dbPath === ":memory:") {
    return null;
  }
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const date = localParts(new Date(), config.timeZone).date;
  const file = join(dir, `crm-${date}.db`);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const old = readdirSync(dir)
    .filter((f) => BACKUP_RE.test(f))
    .sort()
    .slice(0, -KEEP_DAYS);
  for (const f of old) {
    rmSync(join(dir, f), { force: true });
  }
  return file;
};

// `node server/backup.ts` — manual backup (used by the setpro-crm CLI).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${runBackup() ?? "in-memory database: nothing to back up"}\n`
  );
}
