import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const rootDir = process.cwd();
const sqlitePath = path.join(rootDir, "quiz.db");
const wranglerPath = path.join(rootDir, "wrangler.jsonc");
const outputSqlPath = path.join(rootDir, "migrations", "9999_data_from_local.sql");

const args = new Set(process.argv.slice(2));
const shouldApply = args.has("--apply");
const remote = args.has("--local") ? false : true;

if (!fs.existsSync(sqlitePath)) {
  console.error("quiz.db tidak ditemukan:", sqlitePath);
  process.exit(1);
}

if (!fs.existsSync(wranglerPath)) {
  console.error("wrangler.jsonc tidak ditemukan:", wranglerPath);
  process.exit(1);
}

const wranglerRaw = fs.readFileSync(wranglerPath, "utf8");

const db = new Database(sqlitePath, { readonly: true });

const tables = [
  {
    name: "subjects",
    columns: ["id", "name", "start_time", "end_time"],
  },
  {
    name: "questions",
    columns: ["id", "subject_id", "question", "image", "options", "answer"],
  },
  {
    name: "results",
    columns: [
      "id",
      "student_name",
      "nis",
      "class",
      "subject_id",
      "score",
      "correct_count",
      "total_questions",
      "timestamp",
    ],
  },
];

const sqlValue = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const lines = [];
lines.push("-- Auto-generated from quiz.db");
lines.push("PRAGMA foreign_keys = OFF;");
lines.push("BEGIN TRANSACTION;");
lines.push("DELETE FROM results;");
lines.push("DELETE FROM questions;");
lines.push("DELETE FROM subjects;");

const counts = {};
for (const table of tables) {
  const rows = db.prepare(`SELECT ${table.columns.join(", ")} FROM ${table.name} ORDER BY id`).all();
  counts[table.name] = rows.length;
  if (rows.length === 0) continue;

  for (const row of rows) {
    const values = table.columns.map((col) => sqlValue(row[col]));
    lines.push(
      `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES (${values.join(", ")});`
    );
  }
}

lines.push(
  "DELETE FROM sqlite_sequence WHERE name IN ('subjects','questions','results');"
);
lines.push(
  "INSERT INTO sqlite_sequence(name, seq) VALUES ('subjects', COALESCE((SELECT MAX(id) FROM subjects), 0));"
);
lines.push(
  "INSERT INTO sqlite_sequence(name, seq) VALUES ('questions', COALESCE((SELECT MAX(id) FROM questions), 0));"
);
lines.push(
  "INSERT INTO sqlite_sequence(name, seq) VALUES ('results', COALESCE((SELECT MAX(id) FROM results), 0));"
);
lines.push("COMMIT;");
lines.push("PRAGMA foreign_keys = ON;");

fs.mkdirSync(path.dirname(outputSqlPath), { recursive: true });
fs.writeFileSync(outputSqlPath, `${lines.join("\n")}\n`, "utf8");

console.log("SQL dump berhasil dibuat:", path.relative(rootDir, outputSqlPath));
console.log(
  `Jumlah data -> subjects:${counts.subjects ?? 0}, questions:${counts.questions ?? 0}, results:${counts.results ?? 0}`
);

if (!shouldApply) {
  console.log("Mode dump-only selesai. Jalankan ulang dengan --apply untuk impor ke D1.");
  process.exit(0);
}

if (wranglerRaw.includes("REPLACE_WITH_D1_DATABASE_ID")) {
  console.error("database_id di wrangler.jsonc masih placeholder.");
  console.error("Isi dulu database_id dari output: `npx wrangler d1 create quiz_db`");
  process.exit(1);
}

const migrationApplyArgs = [
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "quiz_db",
  ...(remote ? ["--remote"] : ["--local"]),
];
const migrationApply = spawnSync("npx", migrationApplyArgs, {
  stdio: "inherit",
  shell: true,
});
if (migrationApply.status !== 0) {
  process.exit(migrationApply.status ?? 1);
}

const executeArgs = [
  "wrangler",
  "d1",
  "execute",
  "quiz_db",
  ...(remote ? ["--remote"] : ["--local"]),
  "--file",
  outputSqlPath,
];
const execute = spawnSync("npx", executeArgs, {
  stdio: "inherit",
  shell: true,
});
process.exit(execute.status ?? 1);
