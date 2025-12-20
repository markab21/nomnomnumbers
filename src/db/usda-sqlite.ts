/**
 * USDA FoodData Central SQLite Query Module
 *
 * Provides fast local food lookups using Bun's native SQLite.
 */

import { Database } from "bun:sqlite";

const DB_PATH = "./data/usda/usda_fdc.sqlite";

// Nutrient IDs mapped to our field names
const NUTRIENT_MAP: Record<number, string> = {
  1003: "protein",
  1004: "fat",
  1005: "carbs",
  1008: "calories",
  1079: "fiber_g",
  1063: "sugar_g",
  1086: "sugar_alcohols_g",
  1087: "calcium_mg",
  1089: "iron_mg",
  1090: "magnesium_mg",
  1091: "phosphorus_mg",
  1092: "potassium_mg",
  1093: "sodium_mg",
  1095: "zinc_mg",
  1098: "copper_mg",
  1101: "manganese_mg",
  1103: "selenium_ug",
  1104: "vitamin_a_ug",
  1162: "vitamin_c_mg",
  1110: "vitamin_d_ug",
  1109: "vitamin_e_mg",
  1183: "vitamin_k_ug",
  1165: "thiamin_mg",
  1166: "riboflavin_mg",
  1167: "niacin_mg",
  1175: "vitamin_b6_mg",
  1178: "vitamin_b12_ug",
  1177: "folate_ug",
  1180: "choline_mg",
  1253: "cholesterol_mg",
  1258: "saturated_fat_g",
  1292: "monounsaturated_fat_g",
  1293: "polyunsaturated_fat_g",
  1257: "trans_fat_g",
};

export interface USDAFood {
  fdc_id: number;
  description: string;
  brand_owner: string | null;
  brand_name: string | null;
  gtin_upc: string | null;
  serving_size: number | null;
  serving_size_unit: string | null;
  household_serving: string | null;
  data_type: string;
  // Macros
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  // For net carbs calculation
  fiber_g: number | null;
  sugar_g: number | null;
  sugar_alcohols_g: number | null;
  // Calculated
  net_carbs: number | null;
  // Micronutrients
  micronutrients: Record<string, number | null>;
}

let _db: Database | null = null;

function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
}

/**
 * Search foods by text query
 */
export function searchFoods(query: string, limit = 20): USDAFood[] {
  const db = getDb();

  // Use LIKE search with wildcards for each word
  const words = query.trim().split(/\s+/).filter(Boolean);
  const likeConditions = words.map(() => "f.description LIKE ?").join(" AND ");
  const likeParams = words.map((w) => `%${w}%`);

  const foodRows = db
    .query(
      `
    SELECT
      f.fdc_id,
      f.description,
      f.data_type,
      b.brand_owner,
      b.brand_name,
      b.gtin_upc,
      b.serving_size,
      b.serving_size_unit,
      b.household_serving_fulltext as household_serving
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
    brand_name: string | null;
    gtin_upc: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
    household_serving: string | null;
  }>;

  return foodRows.map((row) => enrichWithNutrients(db, row));
}

/**
 * Look up food by barcode (GTIN/UPC)
 */
export function lookupBarcode(barcode: string): USDAFood | null {
  const db = getDb();

  const row = db
    .query(
      `
    SELECT
      f.fdc_id,
      f.description,
      f.data_type,
      b.brand_owner,
      b.brand_name,
      b.gtin_upc,
      b.serving_size,
      b.serving_size_unit,
      b.household_serving_fulltext as household_serving
    FROM branded_food b
    JOIN food f ON b.fdc_id = f.fdc_id
    WHERE b.gtin_upc = ?
    LIMIT 1
  `
    )
    .get(barcode) as {
    fdc_id: number;
    description: string;
    data_type: string;
    brand_owner: string | null;
    brand_name: string | null;
    gtin_upc: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
    household_serving: string | null;
  } | null;

  if (!row) return null;
  return enrichWithNutrients(db, row);
}

/**
 * Get food by FDC ID
 */
export function getFoodById(fdcId: number): USDAFood | null {
  const db = getDb();

  const row = db
    .query(
      `
    SELECT
      f.fdc_id,
      f.description,
      f.data_type,
      b.brand_owner,
      b.brand_name,
      b.gtin_upc,
      b.serving_size,
      b.serving_size_unit,
      b.household_serving_fulltext as household_serving
    FROM food f
    LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
    WHERE f.fdc_id = ?
  `
    )
    .get(fdcId) as {
    fdc_id: number;
    description: string;
    data_type: string;
    brand_owner: string | null;
    brand_name: string | null;
    gtin_upc: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
    household_serving: string | null;
  } | null;

  if (!row) return null;
  return enrichWithNutrients(db, row);
}

/**
 * Enrich a food row with nutrient data
 */
function enrichWithNutrients(
  db: Database,
  row: {
    fdc_id: number;
    description: string;
    data_type: string;
    brand_owner: string | null;
    brand_name: string | null;
    gtin_upc: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
    household_serving: string | null;
  }
): USDAFood {
  // Get all nutrients for this food
  const nutrientRows = db
    .query(
      `
    SELECT nutrient_id, amount
    FROM food_nutrient
    WHERE fdc_id = ?
  `
    )
    .all(row.fdc_id) as Array<{ nutrient_id: number; amount: number | null }>;

  // Build nutrient map
  const nutrients: Record<string, number | null> = {};
  for (const nr of nutrientRows) {
    const fieldName = NUTRIENT_MAP[nr.nutrient_id];
    if (fieldName) {
      nutrients[fieldName] = nr.amount;
    }
  }

  // Extract main macros
  const calories = nutrients["calories"] ?? null;
  const protein = nutrients["protein"] ?? null;
  const carbs = nutrients["carbs"] ?? null;
  const fat = nutrients["fat"] ?? null;
  const fiber_g = nutrients["fiber_g"] ?? null;
  const sugar_g = nutrients["sugar_g"] ?? null;
  const sugar_alcohols_g = nutrients["sugar_alcohols_g"] ?? null;

  // Calculate net carbs: carbs - fiber - sugar_alcohols
  let net_carbs: number | null = null;
  if (carbs !== null) {
    net_carbs = carbs - (fiber_g ?? 0) - (sugar_alcohols_g ?? 0);
  }

  // Build micronutrients object (excluding main macros)
  const micronutrients: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(nutrients)) {
    if (!["calories", "protein", "carbs", "fat", "fiber_g", "sugar_g", "sugar_alcohols_g"].includes(key)) {
      micronutrients[key] = value;
    }
  }

  return {
    fdc_id: row.fdc_id,
    description: row.description,
    brand_owner: row.brand_owner,
    brand_name: row.brand_name,
    gtin_upc: row.gtin_upc,
    serving_size: row.serving_size,
    serving_size_unit: row.serving_size_unit,
    household_serving: row.household_serving,
    data_type: row.data_type,
    calories,
    protein,
    carbs,
    fat,
    fiber_g,
    sugar_g,
    sugar_alcohols_g,
    net_carbs,
    micronutrients,
  };
}

/**
 * Check if the USDA database is available
 */
export function isUSDADatabaseAvailable(): boolean {
  try {
    const file = Bun.file(DB_PATH);
    return file.size > 0;
  } catch {
    return false;
  }
}
