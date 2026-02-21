/**
 * Build a compact single-table USDA database from the full relational one.
 * 
 * Input: Full USDA SQLite at ~/.local/share/nomnom/usda/usda_fdc.sqlite
 * Output: Compact DB at ./data/usda_fdc.sqlite
 * 
 * Schema: Single `food` table with JSON `data` column + FTS5 index
 * Run with: bun run src/db/build-compact.ts
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function getDefaultDataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "nomnom");
  }
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share", "nomnom");
}

const DATA_DIR = process.env.NOMNOM_DATA_DIR || getDefaultDataDir();
const SRC_DB = join(DATA_DIR, "usda", "usda_fdc.sqlite");
const OUT_DIR = join(import.meta.dir, "..", "..", "data");
const OUT_DB = join(OUT_DIR, "usda_fdc.sqlite");

// Nutrients the CLI actually uses
const KEY_NUTRIENTS: Record<number, string> = {
  1008: "cal",
  1003: "protein",
  1005: "carbs",
  1004: "fat",
  1079: "fiber",
  1063: "sugar",
  1093: "sodium",
};

const NUTRIENT_IDS = Object.keys(KEY_NUTRIENTS).join(",");
const BATCH_SIZE = 20000;

async function main() {
  console.log("Build Compact USDA Database");
  console.log("===========================\n");

  if (!existsSync(SRC_DB)) {
    console.error(`Source DB not found: ${SRC_DB}`);
    console.error("Run 'bun run import:usda' first to build the full DB.");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const src = new Database(SRC_DB, { readonly: true });
  
  // Remove old output
  if (existsSync(OUT_DB)) {
    const { rmSync } = await import("node:fs");
    rmSync(OUT_DB);
  }

  const dst = new Database(OUT_DB);
  dst.exec("PRAGMA journal_mode = WAL");
  dst.exec("PRAGMA synchronous = OFF");
  dst.exec("PRAGMA cache_size = -64000");

  dst.exec(`
    CREATE TABLE food (
      fdc_id INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      brand TEXT,
      barcode TEXT,
      data TEXT NOT NULL
    )
  `);

  // Step 1: Build nutrient lookup in chunks using the source DB directly
  // Instead of loading all into JS memory, we'll query per-food in batches
  console.log("Step 1: Getting food ID ranges...");
  const { min_id, max_id, total } = src.query(`
    SELECT min(fdc_id) as min_id, max(fdc_id) as max_id, count(*) as total FROM food
  `).get() as { min_id: number; max_id: number; total: number };
  console.log(`  Foods: ${total.toLocaleString()} (IDs ${min_id} - ${max_id})`);

  // Step 2: Process foods in ID-range chunks
  console.log("\nStep 2: Building compact entries...");
  
  const foodStmt = src.prepare(`
    SELECT f.fdc_id, f.description, b.brand_owner, b.gtin_upc,
           b.serving_size, b.serving_size_unit, b.household_serving_fulltext
    FROM food f
    LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
    WHERE f.fdc_id >= ? AND f.fdc_id < ?
  `);

  const nutrientStmt = src.prepare(`
    SELECT fdc_id, nutrient_id, amount
    FROM food_nutrient
    WHERE fdc_id >= ? AND fdc_id < ?
    AND nutrient_id IN (${NUTRIENT_IDS})
  `);

  const insertStmt = dst.prepare(
    "INSERT INTO food (fdc_id, description, brand, barcode, data) VALUES (?, ?, ?, ?, ?)"
  );
  const insertBatch = dst.transaction((rows: any[][]) => {
    for (const r of rows) insertStmt.run(...r);
  });

  const CHUNK = 50000; // ID range per chunk
  let inserted = 0;
  let skipped = 0;
  let batch: any[][] = [];

  for (let start = min_id; start <= max_id; start += CHUNK) {
    const end = start + CHUNK;

    // Load nutrients for this chunk into a map
    const nutrientMap = new Map<number, Record<string, number>>();
    const nRows = nutrientStmt.all(start, end) as Array<{
      fdc_id: number;
      nutrient_id: number;
      amount: number | null;
    }>;
    for (const row of nRows) {
      if (row.amount == null) continue;
      const key = KEY_NUTRIENTS[row.nutrient_id];
      if (!key) continue;
      if (!nutrientMap.has(row.fdc_id)) nutrientMap.set(row.fdc_id, {});
      nutrientMap.get(row.fdc_id)![key] = row.amount;
    }

    // Process foods in this chunk
    const foods = foodStmt.all(start, end) as Array<{
      fdc_id: number;
      description: string;
      brand_owner: string | null;
      gtin_upc: string | null;
      serving_size: number | null;
      serving_size_unit: string | null;
      household_serving_fulltext: string | null;
    }>;

    for (const food of foods) {
      // Skip foods with no description
      if (!food.description) {
        skipped++;
        continue;
      }

      const nutrients = nutrientMap.get(food.fdc_id) || {};
      const data: Record<string, any> = {};

      if (food.serving_size) data.ss = food.serving_size;
      if (food.serving_size_unit) data.su = food.serving_size_unit;
      if (food.household_serving_fulltext) data.hs = food.household_serving_fulltext;
      Object.assign(data, nutrients);

      // Skip foods with no useful data and no barcode
      if (Object.keys(data).length === 0 && !food.gtin_upc) {
        skipped++;
        continue;
      }

      batch.push([
        food.fdc_id,
        food.description,
        food.brand_owner || null,
        food.gtin_upc || null,
        JSON.stringify(data),
      ]);
      inserted++;

      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch);
        batch = [];
        process.stdout.write(`\r  Processed: ${inserted.toLocaleString()}`);
      }
    }

    // Clear chunk memory
    nutrientMap.clear();
  }

  if (batch.length) insertBatch(batch);
  console.log(`\r  Inserted: ${inserted.toLocaleString()} | Skipped: ${skipped.toLocaleString()}`);

  // Step 3: Indexes
  console.log("\nStep 3: Creating indexes...");
  dst.exec("CREATE INDEX idx_barcode ON food(barcode) WHERE barcode IS NOT NULL");

  // FTS is NOT included in the shipped DB -- built on first run by the CLI
  // This saves ~250MB in the DB file (~100MB gzipped)

  // Step 4: Test
  console.log("\nStep 4: Verification...");

  const barcodeTest = dst.query("SELECT * FROM food WHERE barcode = ?").get("00072940755050") as any;
  if (barcodeTest) {
    console.log(`  Barcode OK: ${barcodeTest.description} - ${barcodeTest.data.substring(0, 60)}`);
  }

  const likeTest = dst.query("SELECT * FROM food WHERE description LIKE '%chicken breast%' LIMIT 3").all() as any[];
  for (const f of likeTest) {
    console.log(`  ${f.description} (${f.brand || "generic"})`);
  }

  const count = dst.query("SELECT count(*) as c FROM food").get() as { c: number };
  console.log(`  Total foods: ${count.c.toLocaleString()}`);

  // Step 6: Finalize
  console.log("\nStep 6: Finalizing...");
  dst.exec("PRAGMA journal_mode = DELETE");
  dst.exec("VACUUM");
  dst.close();
  src.close();

  const size = statSync(OUT_DB).size;
  console.log(`\nOutput: ${OUT_DB}`);
  console.log(`Size: ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log("Done!");
}

main().catch(console.error);
