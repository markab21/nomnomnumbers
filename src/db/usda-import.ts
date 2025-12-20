/**
 * USDA FoodData Central SQLite Import Script
 *
 * Imports CSV data from the USDA bulk download into SQLite using Bun's native SQLite.
 * Run with: bun run src/db/usda-import.ts
 */

import { Database } from "bun:sqlite";
import { $ } from "bun";

const ZIP_PATH = "./data/usda/FoodData_Central_csv_2025-12-18.zip";
const DB_PATH = "./data/usda/usda_fdc.sqlite";

// Nutrient IDs we care about for nutrition tracking
const NUTRIENT_IDS = new Set([
  1003, // Protein
  1004, // Total fat
  1005, // Carbohydrates
  1008, // Energy (kcal)
  1079, // Fiber
  1063, // Sugars
  1086, // Total sugar alcohols
  1087, // Calcium
  1089, // Iron
  1090, // Magnesium
  1091, // Phosphorus
  1092, // Potassium
  1093, // Sodium
  1095, // Zinc
  1098, // Copper
  1101, // Manganese
  1103, // Selenium
  1104, // Vitamin A
  1162, // Vitamin C
  1110, // Vitamin D
  1109, // Vitamin E
  1183, // Vitamin K
  1165, // Thiamin (B1)
  1166, // Riboflavin (B2)
  1167, // Niacin (B3)
  1175, // Vitamin B6
  1178, // Vitamin B12
  1177, // Folate
  1180, // Choline
  1253, // Cholesterol
  1258, // Saturated fat
  1292, // Monounsaturated fat
  1293, // Polyunsaturated fat
  1257, // Trans fat
]);

async function readCsvFromZip(filename: string): Promise<string> {
  const path = `FoodData_Central_csv_2025-12-18/${filename}`;
  return await $`unzip -p ${ZIP_PATH} ${path}`.text();
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
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

  // Create table
  db.run(`DROP TABLE IF EXISTS ${tableName}`);
  db.run(schema);

  const insert = db.prepare(insertSql);
  let count = 0;
  let skipped = 0;

  // Use transaction for batch inserts
  const insertBatch = db.transaction((rows: (string | number | null)[][]) => {
    for (const row of rows) {
      insert.run(...row);
    }
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

  // Insert remaining
  if (batch.length > 0) {
    insertBatch(batch);
  }

  console.log(`\r  Imported: ${count.toLocaleString()} rows${skipped > 0 ? ` (filtered ${skipped.toLocaleString()})` : ""}`);
  return count;
}

async function main() {
  console.log("USDA FoodData Central Import");
  console.log("============================\n");

  // Check zip exists
  const zipFile = Bun.file(ZIP_PATH);
  if (!await zipFile.exists()) {
    console.error(`Error: ZIP file not found at ${ZIP_PATH}`);
    console.error("Download from: https://fdc.nal.usda.gov/download-datasets/");
    process.exit(1);
  }

  // Create database
  console.log(`Creating database: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -64000"); // 64MB cache

  // 1. Import nutrients (small reference table)
  await importTable(
    db,
    "nutrient.csv",
    "nutrient",
    `CREATE TABLE nutrient (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      unit_name TEXT,
      nutrient_nbr TEXT,
      rank REAL
    )`,
    "INSERT OR IGNORE INTO nutrient VALUES (?, ?, ?, ?, ?)",
    (row) => [
      parseInt(row[0]!),
      row[1] ?? null,
      row[2] ?? null,
      row[3] ?? null,
      row[4] ? parseFloat(row[4]) : null,
    ]
  );

  // 2. Import foods (main table)
  await importTable(
    db,
    "food.csv",
    "food",
    `CREATE TABLE food (
      fdc_id INTEGER PRIMARY KEY,
      data_type TEXT,
      description TEXT,
      food_category_id TEXT,
      publication_date TEXT
    )`,
    "INSERT OR IGNORE INTO food VALUES (?, ?, ?, ?, ?)",
    (row) => [
      parseInt(row[0]!),
      row[1] ?? null,
      row[2] ?? null,
      row[3] ?? null,
      row[4] ?? null,
    ]
  );

  // 3. Import branded foods (barcodes, brands, serving sizes)
  await importTable(
    db,
    "branded_food.csv",
    "branded_food",
    `CREATE TABLE branded_food (
      fdc_id INTEGER PRIMARY KEY,
      brand_owner TEXT,
      brand_name TEXT,
      subbrand_name TEXT,
      gtin_upc TEXT,
      ingredients TEXT,
      serving_size REAL,
      serving_size_unit TEXT,
      household_serving_fulltext TEXT,
      branded_food_category TEXT,
      data_source TEXT,
      modified_date TEXT,
      available_date TEXT
    )`,
    "INSERT OR IGNORE INTO branded_food VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (row) => [
      parseInt(row[0]!),
      row[1] || null,
      row[2] || null,
      row[3] || null,
      row[4] || null,
      row[5] || null,
      row[6] ? parseFloat(row[6]) : null,
      row[7] || null,
      row[8] || null,
      row[9] || null,
      row[10] || null,
      row[11] || null,
      row[12] || null,
    ]
  );

  // 4. Import food nutrients (filtered to only nutrients we care about)
  await importTable(
    db,
    "food_nutrient.csv",
    "food_nutrient",
    `CREATE TABLE food_nutrient (
      id INTEGER PRIMARY KEY,
      fdc_id INTEGER,
      nutrient_id INTEGER,
      amount REAL,
      FOREIGN KEY (fdc_id) REFERENCES food(fdc_id),
      FOREIGN KEY (nutrient_id) REFERENCES nutrient(id)
    )`,
    "INSERT OR IGNORE INTO food_nutrient VALUES (?, ?, ?, ?)",
    (row) => [
      parseInt(row[0]!),
      parseInt(row[1]!),
      parseInt(row[2]!),
      row[3] ? parseFloat(row[3]) : null,
    ],
    {
      filter: (row) => NUTRIENT_IDS.has(parseInt(row[2]!)),
      batchSize: 50000,
    }
  );

  // 5. Create indexes for fast lookups
  console.log("\nCreating indexes...");

  db.run("CREATE INDEX IF NOT EXISTS idx_food_description ON food(description)");
  db.run("CREATE INDEX IF NOT EXISTS idx_branded_gtin ON branded_food(gtin_upc)");
  db.run("CREATE INDEX IF NOT EXISTS idx_branded_brand ON branded_food(brand_owner)");
  db.run("CREATE INDEX IF NOT EXISTS idx_food_nutrient_fdc ON food_nutrient(fdc_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_food_nutrient_nutrient ON food_nutrient(nutrient_id)");

  // 6. Create FTS (Full Text Search) table for food names
  console.log("Creating FTS index for food search...");
  db.run("DROP TABLE IF EXISTS food_fts");
  db.run(`
    CREATE VIRTUAL TABLE food_fts USING fts5(
      fdc_id UNINDEXED,
      description,
      brand_owner,
      brand_name,
      content='food_search_view'
    )
  `);

  // Create a view joining food and branded_food
  db.run("DROP VIEW IF EXISTS food_search_view");
  db.run(`
    CREATE VIEW food_search_view AS
    SELECT
      f.fdc_id,
      f.description,
      b.brand_owner,
      b.brand_name
    FROM food f
    LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
  `);

  // Populate FTS
  console.log("Populating FTS index...");
  db.run(`
    INSERT INTO food_fts(fdc_id, description, brand_owner, brand_name)
    SELECT fdc_id, description, brand_owner, brand_name FROM food_search_view
  `);

  // Stats
  console.log("\n============================");
  console.log("Import complete!\n");

  const stats = db.query(`
    SELECT
      (SELECT COUNT(*) FROM food) as foods,
      (SELECT COUNT(*) FROM branded_food) as branded_foods,
      (SELECT COUNT(*) FROM nutrient) as nutrients,
      (SELECT COUNT(*) FROM food_nutrient) as food_nutrients
  `).get() as { foods: number; branded_foods: number; nutrients: number; food_nutrients: number };

  console.log(`Foods: ${stats.foods.toLocaleString()}`);
  console.log(`Branded foods: ${stats.branded_foods.toLocaleString()}`);
  console.log(`Nutrients: ${stats.nutrients.toLocaleString()}`);
  console.log(`Food nutrient values: ${stats.food_nutrients.toLocaleString()}`);

  // Test query
  console.log("\nTest search for 'big mac':");
  const results = db.query(`
    SELECT f.fdc_id, f.description, b.brand_owner, b.gtin_upc
    FROM food_fts
    JOIN food f ON food_fts.fdc_id = f.fdc_id
    LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
    WHERE food_fts MATCH 'big mac'
    LIMIT 5
  `).all();
  console.log(results);

  db.close();
  console.log(`\nDatabase saved to: ${DB_PATH}`);
}

main().catch(console.error);
