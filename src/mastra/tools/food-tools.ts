import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { foodSearchAgent } from "../agents/food-search-agent";
import {
  lookupBarcode as lookupUSDABarcode,
  isUSDADatabaseAvailable,
  type USDAFood,
} from "../../db/usda-sqlite";

// Schema for the food search result with agent synthesis
const foodResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  fiber_g: z.number().nullable(),
  sugar_g: z.number().nullable(),
  sugar_alcohols_g: z.number().nullable(),
  net_carbs: z.number().nullable().describe("Carbs minus fiber minus sugar alcohols"),
  serving_size: z.string().nullable(),
  source: z.string(),
});

export const searchFood = createTool({
  id: "search_food",
  description:
    "Search for foods by name using an AI agent that walks the USDA database (2M+ foods). Returns full nutritional information with synthesized notes including NET CARBS (carbs - fiber - sugar alcohols).",
  inputSchema: z.object({
    query: z.string().describe("Search query for food (e.g., 'big mac', 'quest bar', 'chicken breast')"),
    limit: z.number().int().positive().max(10).default(5).describe("Maximum number of results to analyze"),
  }),
  outputSchema: z.object({
    query: z.string(),
    synthesis: z.string().describe("AI-generated nutritional analysis and notes"),
    source: z.literal("usda-agent"),
  }),
  execute: async ({ context }) => {
    const { query, limit } = context;

    if (!isUSDADatabaseAvailable()) {
      return {
        query,
        synthesis: "USDA database not available. Please run `bun run import:usda` to import the food database.",
        source: "usda-agent" as const,
      };
    }

    // Use the agent to search and synthesize results
    const prompt = `Search for "${query}" in the USDA food database.

Instructions:
1. Use sqlite_search_foods to find matching foods (limit: ${limit})
2. For each relevant result, use sqlite_get_food_details to get full nutrition
3. Provide a detailed analysis for each food including:
   - Name and brand (if branded)
   - Serving size
   - Calories, protein, carbs, fat
   - NET CARBS (calculate: carbs - fiber - sugar_alcohols)
   - Notable micronutrients (sodium if high, etc.)
   - Your synthesis notes (dietary considerations, keto-friendliness, etc.)

Format your response clearly with each food separated.`;

    try {
      const response = await foodSearchAgent.generate(prompt);

      return {
        query,
        synthesis: response.text,
        source: "usda-agent" as const,
      };
    } catch (error) {
      console.error("Agent search error:", error);
      return {
        query,
        synthesis: `Error searching for "${query}": ${error instanceof Error ? error.message : "Unknown error"}`,
        source: "usda-agent" as const,
      };
    }
  },
});

/**
 * Format USDA food for barcode lookup response
 */
function formatUSDAFood(food: USDAFood) {
  const servingSize =
    food.household_serving ||
    (food.serving_size && food.serving_size_unit
      ? `${food.serving_size}${food.serving_size_unit}`
      : "100g");

  return {
    id: `usda-${food.fdc_id}`,
    name: food.description,
    brand: food.brand_owner || food.brand_name || null,
    barcode: food.gtin_upc,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    fiber_g: food.fiber_g,
    sugar_g: food.sugar_g,
    sugar_alcohols_g: food.sugar_alcohols_g,
    net_carbs: food.net_carbs,
    serving_size: servingSize,
    source: "usda-local",
  };
}

export const lookupBarcode = createTool({
  id: "lookup_barcode",
  description:
    "Look up a food item by its barcode (UPC/EAN). Returns the food's full nutritional information including net carbs if found.",
  inputSchema: z.object({
    barcode: z.string().describe("The barcode (UPC/EAN) to look up"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    food: foodResultSchema.nullable(),
  }),
  execute: async ({ context }) => {
    const { barcode } = context;

    // Try local SQLite database
    if (isUSDADatabaseAvailable()) {
      const food = lookupUSDABarcode(barcode);
      if (food) {
        return {
          found: true,
          food: formatUSDAFood(food),
        };
      }
    }

    // Not found
    return {
      found: false,
      food: null,
    };
  },
});
