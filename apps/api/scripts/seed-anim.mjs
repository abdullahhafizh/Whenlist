#!/usr/bin/env node
/**
 * Seed 1000 always-visible checklist items for fall-in animation testing.
 * Usage: node apps/api/scripts/seed-anim.mjs
 *        (or pnpm --filter @whenlist/api db:seed:anim)
 */
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const COUNT = 1000;
const PREFIX = "seedanim";
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

const lines = [];
lines.push(`DELETE FROM item_dependencies WHERE item_id LIKE '${PREFIX}%';`);
lines.push(`DELETE FROM checklist_items WHERE id LIKE '${PREFIX}%';`);

const batchSize = 50;
for (let start = 1; start <= COUNT; start += batchSize) {
  const end = Math.min(COUNT, start + batchSize - 1);
  const values = [];
  for (let i = start; i <= end; i++) {
    const id = `${PREFIX}${String(i).padStart(20, "0")}`;
    const label = `Stack drop ${String(i).padStart(4, "0")}`;
    // once + empty formula = always on checklist until checked
    values.push(
      `('${id}', '${label}', '', 'once', ${i}, 1, 0, NULL, NULL, NULL, NULL, NULL)`,
    );
  }
  lines.push(
    `INSERT INTO checklist_items (id, label, formula, completion_mode, sort_order, is_active, allow_remind, checked_at, window_start_at, remind_at, snoozed_window_at, deleted_at) VALUES\n${values.join(",\n")};`,
  );
}

const sqlPath = join(tmpdir(), `whenlist-seed-anim-${Date.now()}.sql`);
writeFileSync(sqlPath, lines.join("\n"), "utf8");

console.log(`Seeding ${COUNT} items → local D1…`);
const result = spawnSync(
  "pnpm",
  ["exec", "wrangler", "d1", "execute", "checklist-db", "--local", "--file", sqlPath],
  {
    cwd: apiRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

try {
  unlinkSync(sqlPath);
} catch {
  /* ignore */
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`Done. Open Checklist — ${COUNT} items should fall in.`);
