import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { env } from "../src/env.js";

const migrationsDir = fileURLToPath(
  new URL("../src/db/migrations/", import.meta.url),
);

async function main() {
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    for (const file of files) {
      const path = join(migrationsDir, file);
      const body = await readFile(path, "utf8");
      console.log(`Running migration: ${file}`);
      await sql.unsafe(body);
    }
    console.log("Migrations complete.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
