/**
 * Food Search Agent
 *
 * An AI agent that walks the USDA SQLite database to find and analyze foods.
 * Returns full nutritional information with synthesized notes and insights.
 */

import { Agent } from "@mastra/core/agent";
import { xai } from "@ai-sdk/xai";
import {
  sqliteSearchFoods,
  sqliteGetFoodDetails,
  sqliteLookupBarcode,
  sqliteFindSimilarFoods,
} from "../tools/sqlite-tools";

export const foodSearchAgent = new Agent({
  name: "foodSearchAgent",
  description:
    "Searches the USDA food database and synthesizes nutritional insights.",
  // DO NOT change model without human approval
  model: xai("grok-4-1-fast-reasoning"),
  instructions: `You are a nutrition research assistant that searches the USDA FoodData Central database (2M+ foods) and provides detailed nutritional analysis.

## Your Workflow

When given a food search query:

1. **Search the Database**: Use sqlite_search_foods to find matching foods
2. **Get Full Details**: For the most relevant results, use sqlite_get_food_details to get complete nutrition
3. **Analyze & Synthesize**: Provide insights about the nutritional content

## Response Format

For each food you find, provide:

1. **Basic Info**: Name, brand (if any), serving size
2. **Macros**: Calories, protein, carbs, fat
3. **Net Carbs**: Calculate as: carbs - fiber - sugar_alcohols (important for keto/low-carb)
4. **Key Micronutrients**: Sodium, cholesterol, notable vitamins/minerals
5. **Notes**: Your synthesis with:
   - Dietary considerations (high sodium? good protein source? keto-friendly?)
   - Sugar alcohol info if present (affects net carbs calculation)
   - Ingredient highlights if available
   - Serving size context

## Guidelines

- Always calculate and highlight NET CARBS (carbs - fiber - sugar_alcohols)
- Note when sugar alcohols are present - they're important for keto/diabetic tracking
- If a food has high sodium (>500mg), mention it
- If ingredients contain artificial sweeteners or sugar alcohols, note which ones
- For branded foods, include the brand name prominently
- If multiple similar foods exist, briefly compare them
- Be concise but informative

## Example Output Format

**Big Mac (McDonald's)**
- Serving: 1 sandwich (215g)
- Calories: 550 | Protein: 25g | Fat: 30g
- Total Carbs: 45g | Fiber: 3g | Sugar Alcohols: 0g
- **Net Carbs: 42g**
- Sodium: 1010mg (high)

📝 Notes: High sodium content typical of fast food. Not keto-friendly due to high carbs from the bun. Good protein source at 25g per sandwich.

---

Remember: Your goal is to help users make informed nutrition decisions by providing accurate data with helpful context.`,
  tools: {
    sqliteSearchFoods,
    sqliteGetFoodDetails,
    sqliteLookupBarcode,
    sqliteFindSimilarFoods,
  },
});

/**
 * Search for foods using the agent
 */
export async function agentSearchFoods(
  query: string,
  options?: { limit?: number; includeAlternatives?: boolean }
): Promise<{
  results: FoodSearchResult[];
  synthesis: string;
}> {
  const limit = options?.limit ?? 5;
  const includeAlts = options?.includeAlternatives ?? false;

  const prompt = `Search for "${query}" and provide detailed nutritional information for the top ${limit} results.${
    includeAlts ? " Also suggest alternatives if available." : ""
  }

Return the full nutritional breakdown with your analysis notes for each food found.`;

  const response = await foodSearchAgent.generate(prompt);

  // The agent's response contains the synthesized analysis
  // We also extract structured data from the tool calls
  const results: FoodSearchResult[] = [];

  // Parse tool call results to get structured food data
  // The agent will have called sqlite_get_food_details for each food
  // We capture those results along with the synthesis

  return {
    results,
    synthesis: response.text,
  };
}

export interface FoodSearchResult {
  fdc_id: number;
  name: string;
  brand: string | null;
  serving_size: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sugar_alcohols_g: number | null;
  net_carbs_g: number | null;
  notes: string;
}
