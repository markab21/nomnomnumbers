import { describe, test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";

const DB_PATH = "./data/usda/usda_fdc.sqlite";

// Stable sample from USDA branded foods table
const SAMPLE_BARCODE = "00000000924665";
const SAMPLE_FDC_ID = 2689143;
const SAMPLE_QUERY = "kettle corn";

let db: Database;

/**
 * Check if database exists before running tests
 */
function isDatabaseAvailable(): boolean {
  try {
    const file = Bun.file(DB_PATH);
    return file.size > 0;
  } catch {
    return false;
  }
}

/**
 * Helper: Search foods by text query
 */
function searchFoods(
  query: string,
  limit = 10
): Array<{
  fdc_id: number;
  description: string;
  brand_owner: string | null;
  data_type: string;
  has_barcode: boolean;
}> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const likeConditions = words.map(() => "f.description LIKE ?").join(" AND ");
  const likeParams = words.map((w) => `%${w}%`);

  const rows = db
    .query(
      `
      SELECT
        f.fdc_id,
        f.description,
        f.data_type,
        b.brand_owner,
        CASE WHEN b.gtin_upc IS NOT NULL AND b.gtin_upc != '' THEN 1 ELSE 0 END as has_barcode
      FROM food f
      LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
      WHERE ${likeConditions}
      ORDER BY
        CASE WHEN f.data_type = 'branded_food' THEN 0 ELSE 1 END,
        LENGTH(f.description)
      LIMIT ?
    `
    )
    .all(...likeParams, limit) as Array<{
    fdc_id: number;
    description: string;
    data_type: string;
    brand_owner: string | null;
    has_barcode: number;
  }>;

  return rows.map((r) => ({
    fdc_id: r.fdc_id,
    description: r.description,
    brand_owner: r.brand_owner,
    data_type: r.data_type,
    has_barcode: r.has_barcode === 1,
  }));
}

/**
 * Helper: Get food details by FDC ID
 */
function getFoodDetails(fdc_id: number): {
  found: boolean;
  food: {
    fdc_id: number;
    description: string;
    barcode: string | null;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  } | null;
} {
  const foodRow = db
    .query(
      `
      SELECT
        f.fdc_id,
        f.description,
        b.gtin_upc as barcode
      FROM food f
      LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
      WHERE f.fdc_id = ?
    `
    )
    .get(fdc_id) as {
    fdc_id: number;
    description: string;
    barcode: string | null;
  } | null;

  if (!foodRow) {
    return { found: false, food: null };
  }

  // Get key nutrients
  const nutrientRows = db
    .query(
      `
      SELECT n.name, fn.amount
      FROM food_nutrient fn
      JOIN nutrient n ON fn.nutrient_id = n.id
      WHERE fn.fdc_id = ?
    `
    )
    .all(fdc_id) as Array<{ name: string; amount: number | null }>;

  let calories: number | null = null;
  let protein_g: number | null = null;
  let carbs_g: number | null = null;
  let fat_g: number | null = null;

  for (const nr of nutrientRows) {
    const name = nr.name.toLowerCase();
    if (name === "energy") calories = nr.amount;
    if (name === "protein") protein_g = nr.amount;
    if (name === "carbohydrate, by difference") carbs_g = nr.amount;
    if (name === "total lipid (fat)") fat_g = nr.amount;
  }

  return {
    found: true,
    food: {
      fdc_id: foodRow.fdc_id,
      description: foodRow.description,
      barcode: foodRow.barcode,
      calories,
      protein_g,
      carbs_g,
      fat_g,
    },
  };
}

/**
 * Helper: Lookup by barcode
 */
function lookupBarcode(barcode: string): {
  found: boolean;
  fdc_id: number | null;
  description: string | null;
} {
  const row = db
    .query(
      `
      SELECT f.fdc_id, f.description
      FROM branded_food b
      JOIN food f ON b.fdc_id = f.fdc_id
      WHERE b.gtin_upc = ?
      LIMIT 1
    `
    )
    .get(barcode) as { fdc_id: number; description: string } | null;

  if (!row) {
    return { found: false, fdc_id: null, description: null };
  }

  return { found: true, fdc_id: row.fdc_id, description: row.description };
}

/**
 * Helper: Find similar foods
 */
function findSimilarFoods(
  fdc_id: number,
  limit = 5
): Array<{
  fdc_id: number;
  description: string;
  brand_owner: string | null;
}> {
  const refFood = db.query("SELECT description FROM food WHERE fdc_id = ?").get(fdc_id) as { description: string } | null;

  if (!refFood) return [];

  const words = refFood.description
    .split(/[\s,]+/)
    .filter((w) => w.length > 3)
    .slice(0, 3);

  if (words.length === 0) return [];

  const likeConditions = words.map(() => "f.description LIKE ?").join(" OR ");
  const likeParams = words.map((w) => `%${w}%`);

  const rows = db
    .query(
      `
      SELECT DISTINCT
        f.fdc_id,
        f.description,
        b.brand_owner
      FROM food f
      LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
      WHERE (${likeConditions}) AND f.fdc_id != ?
      ORDER BY LENGTH(f.description)
      LIMIT ?
    `
    )
    .all(...likeParams, fdc_id, limit) as Array<{
    fdc_id: number;
    description: string;
    brand_owner: string | null;
  }>;

  return rows;
}

/**
 * Helper: Get database stats
 */
function getStats(): {
  total_foods: number;
  branded_foods: number;
  foods_with_barcodes: number;
} {
  return db
    .query(
      `
      SELECT
        (SELECT COUNT(*) FROM food) as total_foods,
        (SELECT COUNT(*) FROM branded_food) as branded_foods,
        (SELECT COUNT(*) FROM branded_food WHERE gtin_upc IS NOT NULL AND gtin_upc != '') as foods_with_barcodes
    `
    )
    .get() as {
    total_foods: number;
    branded_foods: number;
    foods_with_barcodes: number;
  };
}

describe.skipIf(!isDatabaseAvailable())("USDA SQLite Database", () => {
  beforeAll(() => {
    db = new Database(DB_PATH, { readonly: true });
  });

  test("reports database stats", () => {
    const stats = getStats();
    expect(stats.total_foods).toBeGreaterThan(100_000);
    expect(stats.branded_foods).toBeGreaterThan(10_000);
    expect(stats.foods_with_barcodes).toBeGreaterThan(1_000);
  });

  test("searches foods by text query", () => {
    const results = searchFoods(SAMPLE_QUERY, 40);
    expect(results.length).toBeGreaterThan(0);

    // At least one result should contain our search terms
    const hasMatch = results.some((r) => r.description.toLowerCase().includes("kettle"));
    expect(hasMatch).toBe(true);
  });

  test("gets full details for a known FDC ID", () => {
    const details = getFoodDetails(SAMPLE_FDC_ID);
    expect(details.found).toBe(true);
    expect(details.food).not.toBeNull();
    expect(details.food?.barcode).toBe(SAMPLE_BARCODE);
    expect(details.food?.description.toLowerCase()).toContain("kettle corn");
  });

  test("looks up food by barcode", () => {
    const lookup = lookupBarcode(SAMPLE_BARCODE);
    expect(lookup.found).toBe(true);
    expect(lookup.fdc_id).toBe(SAMPLE_FDC_ID);
  });

  test("finds similar foods", () => {
    const similar = findSimilarFoods(SAMPLE_FDC_ID, 5);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar.length).toBeLessThanOrEqual(5);
  });

  test("returns not found for invalid barcode", () => {
    const lookup = lookupBarcode("0000000000000");
    expect(lookup.found).toBe(false);
    expect(lookup.fdc_id).toBeNull();
  });

  test("returns not found for invalid FDC ID", () => {
    const details = getFoodDetails(999999999);
    expect(details.found).toBe(false);
    expect(details.food).toBeNull();
  });
});
