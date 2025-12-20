/**
 * Low-level SQLite query tools for the agent to walk the USDA database
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Database } from "bun:sqlite";

const DB_PATH = "./data/usda/usda_fdc.sqlite";

let _db: Database | null = null;

function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
}

/**
 * Search foods by text - returns basic info for browsing
 */
export const sqliteSearchFoods = createTool({
  id: "sqlite_search_foods",
  description:
    "Search the USDA food database by text. Returns a list of matching foods with basic info. Use this to find foods, then use sqlite_get_food_details for full nutrition.",
  inputSchema: z.object({
    query: z.string().describe("Search terms (e.g., 'big mac', 'chicken breast', 'quest bar')"),
    limit: z.number().int().positive().max(25).default(10).describe("Max results to return"),
  }),
  outputSchema: z.object({
    foods: z.array(
      z.object({
        fdc_id: z.number(),
        description: z.string(),
        brand_owner: z.string().nullable(),
        data_type: z.string(),
        has_barcode: z.boolean(),
      })
    ),
    count: z.number(),
    query: z.string(),
  }),
  execute: async ({ context }) => {
    const { query, limit } = context;
    const db = getDb();

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

    return {
      foods: rows.map((r) => ({
        fdc_id: r.fdc_id,
        description: r.description,
        brand_owner: r.brand_owner,
        data_type: r.data_type,
        has_barcode: r.has_barcode === 1,
      })),
      count: rows.length,
      query,
    };
  },
});

/**
 * Get full details for a specific food by FDC ID
 */
export const sqliteGetFoodDetails = createTool({
  id: "sqlite_get_food_details",
  description:
    "Get complete nutritional details for a food by its FDC ID. Includes all macros, micronutrients, serving info, and ingredients.",
  inputSchema: z.object({
    fdc_id: z.number().describe("The USDA FDC ID of the food"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    food: z
      .object({
        fdc_id: z.number(),
        description: z.string(),
        data_type: z.string(),
        brand_owner: z.string().nullable(),
        brand_name: z.string().nullable(),
        barcode: z.string().nullable(),
        ingredients: z.string().nullable(),
        serving_size: z.number().nullable(),
        serving_size_unit: z.string().nullable(),
        household_serving: z.string().nullable(),
        // Macros
        calories: z.number().nullable(),
        protein_g: z.number().nullable(),
        carbs_g: z.number().nullable(),
        fat_g: z.number().nullable(),
        fiber_g: z.number().nullable(),
        sugar_g: z.number().nullable(),
        sugar_alcohols_g: z.number().nullable(),
        net_carbs_g: z.number().nullable(),
        // Key micronutrients
        sodium_mg: z.number().nullable(),
        cholesterol_mg: z.number().nullable(),
        saturated_fat_g: z.number().nullable(),
        trans_fat_g: z.number().nullable(),
        // All nutrients as a map
        all_nutrients: z.record(z.string(), z.number().nullable()),
      })
      .nullable(),
  }),
  execute: async ({ context }) => {
    const { fdc_id } = context;
    const db = getDb();

    // Get food basic info
    const foodRow = db
      .query(
        `
        SELECT
          f.fdc_id,
          f.description,
          f.data_type,
          b.brand_owner,
          b.brand_name,
          b.gtin_upc as barcode,
          b.ingredients,
          b.serving_size,
          b.serving_size_unit,
          b.household_serving_fulltext as household_serving
        FROM food f
        LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
        WHERE f.fdc_id = ?
      `
      )
      .get(fdc_id) as {
      fdc_id: number;
      description: string;
      data_type: string;
      brand_owner: string | null;
      brand_name: string | null;
      barcode: string | null;
      ingredients: string | null;
      serving_size: number | null;
      serving_size_unit: string | null;
      household_serving: string | null;
    } | null;

    if (!foodRow) {
      return { found: false, food: null };
    }

    // Get all nutrients with names
    const nutrientRows = db
      .query(
        `
        SELECT n.name, n.unit_name, fn.amount
        FROM food_nutrient fn
        JOIN nutrient n ON fn.nutrient_id = n.id
        WHERE fn.fdc_id = ?
      `
      )
      .all(fdc_id) as Array<{
      name: string;
      unit_name: string;
      amount: number | null;
    }>;

    // Build nutrient map
    const allNutrients: Record<string, number | null> = {};
    let calories: number | null = null;
    let protein_g: number | null = null;
    let carbs_g: number | null = null;
    let fat_g: number | null = null;
    let fiber_g: number | null = null;
    let sugar_g: number | null = null;
    let sugar_alcohols_g: number | null = null;
    let sodium_mg: number | null = null;
    let cholesterol_mg: number | null = null;
    let saturated_fat_g: number | null = null;
    let trans_fat_g: number | null = null;

    for (const nr of nutrientRows) {
      const key = `${nr.name} (${nr.unit_name})`;
      allNutrients[key] = nr.amount;

      // Extract key nutrients
      const name = nr.name.toLowerCase();
      if (name === "energy" && nr.unit_name === "KCAL") calories = nr.amount;
      if (name === "protein") protein_g = nr.amount;
      if (name === "carbohydrate, by difference") carbs_g = nr.amount;
      if (name === "total lipid (fat)") fat_g = nr.amount;
      if (name === "fiber, total dietary") fiber_g = nr.amount;
      if (name.includes("sugars, total")) sugar_g = nr.amount;
      if (name === "total sugar alcohols") sugar_alcohols_g = nr.amount;
      if (name === "sodium, na") sodium_mg = nr.amount;
      if (name === "cholesterol") cholesterol_mg = nr.amount;
      if (name.includes("saturated")) saturated_fat_g = nr.amount;
      if (name.includes("trans")) trans_fat_g = nr.amount;
    }

    // Calculate net carbs
    let net_carbs_g: number | null = null;
    if (carbs_g !== null) {
      net_carbs_g = carbs_g - (fiber_g ?? 0) - (sugar_alcohols_g ?? 0);
    }

    return {
      found: true,
      food: {
        fdc_id: foodRow.fdc_id,
        description: foodRow.description,
        data_type: foodRow.data_type,
        brand_owner: foodRow.brand_owner,
        brand_name: foodRow.brand_name,
        barcode: foodRow.barcode,
        ingredients: foodRow.ingredients,
        serving_size: foodRow.serving_size,
        serving_size_unit: foodRow.serving_size_unit,
        household_serving: foodRow.household_serving,
        calories,
        protein_g,
        carbs_g,
        fat_g,
        fiber_g,
        sugar_g,
        sugar_alcohols_g,
        net_carbs_g,
        sodium_mg,
        cholesterol_mg,
        saturated_fat_g,
        trans_fat_g,
        all_nutrients: allNutrients,
      },
    };
  },
});

/**
 * Lookup food by barcode
 */
export const sqliteLookupBarcode = createTool({
  id: "sqlite_lookup_barcode",
  description: "Look up a food by its barcode (UPC/EAN). Returns the FDC ID if found.",
  inputSchema: z.object({
    barcode: z.string().describe("The barcode (UPC/EAN) to look up"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    fdc_id: z.number().nullable(),
    description: z.string().nullable(),
    brand_owner: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    const { barcode } = context;
    const db = getDb();

    const row = db
      .query(
        `
        SELECT f.fdc_id, f.description, b.brand_owner
        FROM branded_food b
        JOIN food f ON b.fdc_id = f.fdc_id
        WHERE b.gtin_upc = ?
        LIMIT 1
      `
      )
      .get(barcode) as {
      fdc_id: number;
      description: string;
      brand_owner: string | null;
    } | null;

    if (!row) {
      return { found: false, fdc_id: null, description: null, brand_owner: null };
    }

    return {
      found: true,
      fdc_id: row.fdc_id,
      description: row.description,
      brand_owner: row.brand_owner,
    };
  },
});

/**
 * Find similar foods (for alternatives/suggestions)
 */
export const sqliteFindSimilarFoods = createTool({
  id: "sqlite_find_similar",
  description:
    "Find foods similar to a given food. Useful for suggesting alternatives or finding different brands of the same product.",
  inputSchema: z.object({
    fdc_id: z.number().describe("The FDC ID of the reference food"),
    limit: z.number().int().positive().max(10).default(5).describe("Max similar foods to return"),
  }),
  outputSchema: z.object({
    reference_food: z.string(),
    similar_foods: z.array(
      z.object({
        fdc_id: z.number(),
        description: z.string(),
        brand_owner: z.string().nullable(),
        calories: z.number().nullable(),
      })
    ),
  }),
  execute: async ({ context }) => {
    const { fdc_id, limit } = context;
    const db = getDb();

    // Get reference food
    const refFood = db
      .query("SELECT description FROM food WHERE fdc_id = ?")
      .get(fdc_id) as { description: string } | null;

    if (!refFood) {
      return { reference_food: "Not found", similar_foods: [] };
    }

    // Extract key words from the description (simple approach)
    const words = refFood.description
      .split(/[\s,]+/)
      .filter((w) => w.length > 3)
      .slice(0, 3);

    if (words.length === 0) {
      return { reference_food: refFood.description, similar_foods: [] };
    }

    const likeConditions = words.map(() => "f.description LIKE ?").join(" OR ");
    const likeParams = words.map((w) => `%${w}%`);

    // Step 1: fetch similar items (no nutrient join to keep the query fast)
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

    // Step 2: lookup calories individually for the small result set
    const calorieStmt = db.prepare("SELECT amount FROM food_nutrient WHERE fdc_id = ? AND nutrient_id = 1008 LIMIT 1");

    return {
      reference_food: refFood.description,
      similar_foods: rows.map((r) => ({
        ...r,
        calories: (calorieStmt.get(r.fdc_id) as number | null) ?? null,
      })),
    };
  },
});

/**
 * Get database stats
 */
export const sqliteGetStats = createTool({
  id: "sqlite_get_stats",
  description: "Get statistics about the USDA food database - total foods, branded foods, etc.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    total_foods: z.number(),
    branded_foods: z.number(),
    foods_with_barcodes: z.number(),
    total_nutrients_tracked: z.number(),
  }),
  execute: async () => {
    const db = getDb();

    const stats = db
      .query(
        `
        SELECT
          (SELECT COUNT(*) FROM food) as total_foods,
          (SELECT COUNT(*) FROM branded_food) as branded_foods,
          (SELECT COUNT(*) FROM branded_food WHERE gtin_upc IS NOT NULL AND gtin_upc != '') as foods_with_barcodes,
          (SELECT COUNT(*) FROM nutrient) as total_nutrients_tracked
      `
      )
      .get() as {
      total_foods: number;
      branded_foods: number;
      foods_with_barcodes: number;
      total_nutrients_tracked: number;
    };

    return stats;
  },
});
