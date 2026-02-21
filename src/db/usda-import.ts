/**
 * USDA FoodData Central SQLite Import Script
 *
 * Imports CSV data from the USDA bulk download into SQLite using Bun's native SQLite.
 * Run with: bun run import:usda
 */

import { Database } from "bun:sqlite";
import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function getDefaultDataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "nomnom");
  }
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share", "nomnom");
}

const DATA_DIR = process.env.NOMNOM_DATA_DIR || getDefaultDataDir();
const USDA_DIR = join(DATA_DIR, "usda");
const ZIP_PATH = join(USDA_DIR, "FoodData_Central_csv_2025-12-18.zip");
const DB_PATH = join(USDA_DIR, "usda_fdc.sqlite");

const NUTRIENT_IDS = new Set([
  1003, 1004, 1005, 1008, 1079, 1063, 1086, 1087, 1089, 1090,
  1091, 1092, 1093, 1095, 1098, 1101, 1103, 1104, 1162, 1110,
  1109, 1183, 1165, 1166, 1167, 1175, 1178, 1177, 1180, 1253,
  1258, 1292, 1293, 1257,
]);

async function readCsvFromZip(filename: string): Promise<string> {
  const path = `FoodData_Central_csv_2025-12-18/${filename}`;
  return await $`unzip -p ${ZIP_PATH} ${path}`.text();
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function importTable(
  db: Database,
  filename: string,
  tableName: string,
  schema: string,
  insertSql: string,
  rowMapper: (row: string[]) => (string | number | null)[] | null,
  options?: { filter?: (row: string[]) => boolean; batchSize?: number }
): Promise<number> {
  const batchSize = options?.batchSize ?? 10000;
  console.log(`\nImporting ${filename}...`);

  const csv = await readCsvFromZip(filename);
  const lines = csv.trim().split("\n");
  const headers = parseCsvLine(lines[0]!);
  console.log(`  Headers: ${headers.join(", ")}`);
  console.log(`  Total rows: ${(lines.length - 1).toLocaleString()}`);

  db.run(`DROP TABLE IF EXISTS ${tableName}`);
  db.run(schema);

  const insert = db.prepare(insertSql);
  let count = 0;
  let skipped = 0;

  const insertBatch = db.transaction((rows: (string | number | null)[][]) => {
    for (const row of rows) insert.run(...row);
  });

  let batch: (string | number | null)[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]!);

    if (options?.filter && !options.filter(row)) {
      skipped++;
      continue;
    }

    const mapped = rowMapper(row);
    if (mapped) {
      batch.push(mapped);
      count++;

      if (batch.length >= batchSize) {
        insertBatch(batch);
        batch = [];
        process.stdout.write(`\r  Imported: ${count.toLocaleString()}`);
      }
    }
  }

  if (batch.length > 0) insertBatch(batch);

  console.log(`\r  Imported: ${count.toLocaleString()} rows${skipped > 0 ? ` (filtered ${skipped.toLocaleString()})` : ""}`);
  return count;
}

async function main() {
  console.log("USDA FoodData Central Import");
  console.log("============================\n");
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Output: ${DB_PATH}\n`);

  // Ensure directory exists
  mkdirSync(USDA_DIR, { recursive: true });

  // Check zip exists
  if (!existsSync(ZIP_PATH)) {
    console.error(`Error: ZIP file not found at ${ZIP_PATH}`);
    console.error("\nTo download:");
    console.error("  1. Visit https://fdc.nal.usda.gov/download-datasets/");
    console.error("  2. Download 'Full Download' CSV zip");
    console.error(`  3. Save to: ${ZIP_PATH}`);
    process.exit(1);
  }

  console.log(`Creating database: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -64000");

  await importTable(
    db,
    "nutrient.csv",
    "nutrient",
    `CREATE TABLE nutrient (id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit_name TEXT, nutrient_nbr TEXT, rank REAL)`,
    "INSERT OR IGNORE INTO nutrient VALUES (?, ?, ?, ?, ?)",
    (row) => [parseInt(row[0]!), row[1] ?? null, row[2] ?? null, row[3] ?? null, row[4] ? parseFloat(row[4]) : null]
  );

  await importTable(
    db,
    "food.csv",
    "food",
    `CREATE TABLE food (fdc_id INTEGER PRIMARY KEY, data_type TEXT, description TEXT, food_category_id TEXT, publication_date TEXT)`,
    "INSERT OR IGNORE INTO food VALUES (?, ?, ?, ?, ?)",
    (row) => [parseInt(row[0]!), row[1] ?? null, row[2] ?? null, row[3] ?? null, row[4] ?? null]
  );

  await importTable(
    db,
    "branded_food.csv",
    "branded_food",
    `CREATE TABLE branded_food (fdc_id INTEGER PRIMARY KEY, brand_owner TEXT, brand_name TEXT, subbrand_name TEXT, gtin_upc TEXT, ingredients TEXT, serving_size REAL, serving_size_unit TEXT, household_serving_fulltext TEXT, branded_food_category TEXT, data_source TEXT, modified_date TEXT, available_date TEXT)`,
    "INSERT OR IGNORE INTO branded_food VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (row) => [
      parseInt(row[0]!), row[1] || null, row[2] || null, row[3] || null, row[4] || null,
      row[5] || null, row[7] ? parseFloat(row[7]) : null, row[8] || null, row[9] || null,
      row[10] || null, row[11] || null, row[13] || null, row[14] || null,
    ]
  );

  await importTable(
    db,
    "food_nutrient.csv",
    "food_nutrient",
    `CREATE TABLE food_nutrient (id INTEGER PRIMARY KEY, fdc_id INTEGER, nutrient_id INTEGER, amount REAL, FOREIGN KEY (fdc_id) REFERENCES food(fdc_id), FOREIGN KEY (nutrient_id) REFERENCES nutrient(id))`,
    "INSERT OR IGNORE INTO food_nutrient VALUES (?, ?, ?, ?)",
    (row) => [parseInt(row[0]!), parseInt(row[1]!), parseInt(row[2]!), row[3] ? parseFloat(row[3]) : null],
    { filter: (row) => NUTRIENT_IDS.has(parseInt(row[2]!)), batchSize: 50000 }
  );

  console.log("\nCreating indexes...");
  db.run("CREATE INDEX IF NOT EXISTS idx_food_description ON food(description)");
  db.run("CREATE INDEX IF NOT EXISTS idx_branded_gtin ON branded_food(gtin_upc)");
  db.run("CREATE INDEX IF NOT EXISTS idx_food_nutrient_fdc ON food_nutrient(fdc_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_food_nutrient_nutrient ON food_nutrient(nutrient_id)");

  console.log("Creating FTS index for food search...");
  db.run("DROP TABLE IF EXISTS food_fts");
  db.run(`
    CREATE VIRTUAL TABLE food_fts USING fts5(
      fdc_id UNINDEXED,
      description,
      brand_owner
    )
  `);

  console.log("Populating FTS index...");
  db.run(`
    INSERT INTO food_fts(fdc_id, description, brand_owner)
    SELECT f.fdc_id, f.description, b.brand_owner
    FROM food f
    LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
  `);

  console.log("\n============================");
  console.log("Import complete!\n");

  const stats = db.query(`
    SELECT
      (SELECT COUNT(*) FROM food) as foods,
      (SELECT COUNT(*) FROM branded_food) as branded_foods,
      (SELECT COUNT(*) FROM food_nutrient) as food_nutrients
  `).get() as { foods: number; branded_foods: number; food_nutrients: number };

  console.log(`Foods: ${stats.foods.toLocaleString()}`);
  console.log(`Branded foods: ${stats.branded_foods.toLocaleString()}`);
  console.log(`Food nutrient values: ${stats.food_nutrients.toLocaleString()}`);

  console.log("\nTest search for 'chicken':");
  const results = db.query(`
    SELECT f.fdc_id, f.description, b.brand_owner
    FROM food_fts
    JOIN food f ON food_fts.fdc_id = f.fdc_id
    LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
    WHERE food_fts MATCH 'chicken'
    LIMIT 5
  `).all();
  console.log(results);

  db.close();
  console.log(`\nDatabase saved to: ${DB_PATH}`);
  console.log(`\nConfig updated. Run 'nomnom config' to verify paths.`);
}

main().catch(console.error);
