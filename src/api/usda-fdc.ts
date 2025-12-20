/**
 * USDA FoodData Central API Client
 * https://fdc.nal.usda.gov/api-guide.html
 */

import type { FullNutrition } from "../db/nutrient-fields";

const BASE_URL = "https://api.nal.usda.gov/fdc/v1";

export interface USDAFoodNutrient {
  nutrientId: number;
  nutrientName: string;
  nutrientNumber: string;
  unitName: string;
  value: number;
}

export interface USDAFood {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients: USDAFoodNutrient[];
  foodMeasures?: Array<{
    disseminationText: string;
    gramWeight: number;
  }>;
}

export interface USDASearchResponse {
  totalHits: number;
  currentPage: number;
  totalPages: number;
  foods: USDAFood[];
}

/**
 * Normalized food data with full nutrition (flat structure)
 * All nutrition fields are at top level, not nested
 */
export interface NormalizedFood extends FullNutrition {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  serving_size: string;
  serving_grams: number;
  source: "usda";
}

function getApiKey(): string {
  const key = process.env.USDA_FDC_API_KEY;
  if (!key) {
    throw new Error("USDA_FDC_API_KEY environment variable is not set");
  }
  return key;
}

/**
 * USDA Nutrient Numbers Reference:
 * https://fdc.nal.usda.gov/portal-data/external/dataDictionary
 */
const NUTRIENT_MAP = {
  // Macros
  calories: "208",      // Energy (kcal)
  protein: "203",       // Protein
  carbs: "205",         // Carbohydrate, by difference
  fat: "204",           // Total lipid (fat)

  // Vitamins
  vitamin_a: "320",     // Vitamin A, RAE
  vitamin_c: "401",     // Vitamin C
  vitamin_d: "328",     // Vitamin D (D2 + D3)
  vitamin_e: "323",     // Vitamin E (alpha-tocopherol)
  vitamin_k: "430",     // Vitamin K (phylloquinone)
  thiamin: "404",       // Thiamin (B1)
  riboflavin: "405",    // Riboflavin (B2)
  niacin: "406",        // Niacin (B3)
  vitamin_b6: "415",    // Vitamin B-6
  vitamin_b12: "418",   // Vitamin B-12
  folate: "435",        // Folate, DFE (or 417 for total)
  choline: "421",       // Choline, total

  // Minerals
  calcium: "301",       // Calcium, Ca
  iron: "303",          // Iron, Fe
  magnesium: "304",     // Magnesium, Mg
  phosphorus: "305",    // Phosphorus, P
  potassium: "306",     // Potassium, K
  sodium: "307",        // Sodium, Na
  zinc: "309",          // Zinc, Zn
  copper: "312",        // Copper, Cu
  manganese: "315",     // Manganese, Mn
  selenium: "317",      // Selenium, Se

  // Other
  fiber: "291",         // Fiber, total dietary
  sugar: "269",         // Total Sugars
  cholesterol: "601",   // Cholesterol
  saturated_fat: "606", // Fatty acids, total saturated
  monounsaturated_fat: "645", // Fatty acids, total monounsaturated
  polyunsaturated_fat: "646", // Fatty acids, total polyunsaturated
  trans_fat: "605",     // Fatty acids, total trans
} as const;

/**
 * Extract a nutrient value from USDA food nutrients array
 */
function getNutrientValue(
  nutrients: USDAFoodNutrient[],
  nutrientNumber: string
): number | null {
  const nutrient = nutrients.find((n) => n.nutrientNumber === nutrientNumber);
  return nutrient ? nutrient.value : null;
}

/**
 * Round to specified decimal places, handling null
 */
function round(value: number | null, decimals: number = 1): number | null {
  if (value === null) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Normalize USDA food data to our schema with full micronutrients
 */
export function normalizeUSDAFood(food: USDAFood): NormalizedFood {
  const nutrients = food.foodNutrients;

  // Get serving size from food measures or default to 100g
  let servingSize = "100g";
  let servingGrams = 100;

  if (food.servingSize && food.servingSizeUnit) {
    servingSize = `${food.servingSize}${food.servingSizeUnit}`;
    servingGrams = food.servingSize;
  } else if (food.foodMeasures && food.foodMeasures.length > 0) {
    const measure = food.foodMeasures[0];
    if (measure) {
      servingSize = measure.disseminationText;
      servingGrams = measure.gramWeight;
    }
  }

  // Scale factor: USDA values are per 100g
  const scale = servingGrams / 100;

  // Helper to get scaled nutrient value
  const getScaled = (key: keyof typeof NUTRIENT_MAP): number | null => {
    const raw = getNutrientValue(nutrients, NUTRIENT_MAP[key]);
    return raw !== null ? round(raw * scale) : null;
  };

  // Estimate omega-3/6 from polyunsaturated fat components if available
  // USDA has specific fatty acid data but it varies by food
  const omega3 = round(
    (getNutrientValue(nutrients, "621") ?? 0) + // DHA
    (getNutrientValue(nutrients, "629") ?? 0) + // EPA
    (getNutrientValue(nutrients, "619") ?? 0) * 0.5, // ALA (partial)
    2
  );
  const omega6 = round(
    (getNutrientValue(nutrients, "618") ?? 0) * scale, // Linoleic acid
    2
  );

  // Calculate net carbs
  const fiber = getScaled("fiber");
  const sugar_alcohols = null; // USDA doesn't have sugar alcohols directly
  const carbs_val = round((getNutrientValue(nutrients, NUTRIENT_MAP.carbs) ?? 0) * scale) ?? 0;
  const net_carbs = fiber !== null ? carbs_val - fiber : null;

  return {
    // Metadata
    id: `usda-${food.fdcId}`,
    name: food.description,
    brand: food.brandOwner || food.brandName || null,
    barcode: null,
    serving_size: servingSize,
    serving_grams: servingGrams,
    source: "usda" as const,

    // Core macros
    calories: Math.round((getNutrientValue(nutrients, NUTRIENT_MAP.calories) ?? 0) * scale),
    protein: round((getNutrientValue(nutrients, NUTRIENT_MAP.protein) ?? 0) * scale) ?? 0,
    carbs: carbs_val,
    fat: round((getNutrientValue(nutrients, NUTRIENT_MAP.fat) ?? 0) * scale) ?? 0,

    // Extended macros
    fiber_g: fiber,
    sugar_g: getScaled("sugar"),
    sugar_alcohols_g: sugar_alcohols,
    net_carbs: net_carbs,
    cholesterol_mg: getScaled("cholesterol"),
    saturated_fat_g: getScaled("saturated_fat"),
    trans_fat_g: getScaled("trans_fat"),
    monounsaturated_fat_g: getScaled("monounsaturated_fat"),
    polyunsaturated_fat_g: getScaled("polyunsaturated_fat"),
    omega_3_g: omega3 || null,
    omega_6_g: omega6 || null,

    // Vitamins
    vitamin_a_ug: getScaled("vitamin_a"),
    vitamin_c_mg: getScaled("vitamin_c"),
    vitamin_d_ug: getScaled("vitamin_d"),
    vitamin_e_mg: getScaled("vitamin_e"),
    vitamin_k_ug: getScaled("vitamin_k"),
    thiamin_mg: getScaled("thiamin"),
    riboflavin_mg: getScaled("riboflavin"),
    niacin_mg: getScaled("niacin"),
    vitamin_b6_mg: getScaled("vitamin_b6"),
    vitamin_b12_ug: getScaled("vitamin_b12"),
    folate_ug: getScaled("folate"),
    choline_mg: getScaled("choline"),

    // Minerals
    calcium_mg: getScaled("calcium"),
    iron_mg: getScaled("iron"),
    magnesium_mg: getScaled("magnesium"),
    phosphorus_mg: getScaled("phosphorus"),
    potassium_mg: getScaled("potassium"),
    sodium_mg: getScaled("sodium"),
    zinc_mg: getScaled("zinc"),
    copper_mg: getScaled("copper"),
    manganese_mg: getScaled("manganese"),
    selenium_ug: getScaled("selenium"),
  };
}

/**
 * Search for foods in USDA FoodData Central
 */
export async function searchUSDAFoods(
  query: string,
  limit: number = 10
): Promise<NormalizedFood[]> {
  const apiKey = getApiKey();
  const url = `${BASE_URL}/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=${limit}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`USDA API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as USDASearchResponse;

  return data.foods.map(normalizeUSDAFood);
}

/**
 * Get a specific food by FDC ID
 */
export async function getUSDAFoodById(fdcId: number): Promise<NormalizedFood | null> {
  const apiKey = getApiKey();
  const url = `${BASE_URL}/food/${fdcId}?api_key=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`USDA API error: ${response.status} ${response.statusText}`);
  }

  const food = (await response.json()) as USDAFood;
  return normalizeUSDAFood(food);
}
