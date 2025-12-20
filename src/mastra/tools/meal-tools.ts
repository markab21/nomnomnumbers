import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  addMealLog,
  getMealsByDate,
  getMealHistory,
  searchMealLogs,
  getUserGoals,
} from "../../db";
import {
  optionalNutritionSchema,
  NUTRIENT_KEYS,
  DEFAULT_NUTRITION,
  type FullNutrition,
} from "../../db/nutrient-fields";

const mealTypeEnum = z.enum(["breakfast", "lunch", "dinner", "snack"]);

// Schema for meal with full nutrition in output
const mealOutputSchema = z.object({
  id: z.string(),
  foodName: z.string(),
  quantity: z.number(),
  unit: z.string(),
  mealType: z.string(),
  loggedAt: z.string(),
  notes: z.string().nullable(),
  // Core macros
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  // Extended macros (nullable)
  fiber_g: z.number().nullable(),
  sugar_g: z.number().nullable(),
  net_carbs: z.number().nullable(),
  sodium_mg: z.number().nullable(),
  saturated_fat_g: z.number().nullable(),
  cholesterol_mg: z.number().nullable(),
});

export const logMeal = createTool({
  id: "log_meal",
  description:
    "Log a meal entry with full nutritional information. Records what the user ate including all macros, fiber, sugar, sodium, and more.",
  inputSchema: z
    .object({
      userId: z.string().describe("The user ID"),
      foodId: z.string().optional().describe("Optional food ID from database"),
      foodName: z.string().describe("Name of the food eaten"),
      quantity: z.number().positive().describe("Quantity consumed"),
      unit: z.string().default("serving").describe("Unit of measurement (e.g., 'serving', 'g', 'oz')"),
      mealType: mealTypeEnum.describe("Type of meal: breakfast, lunch, dinner, or snack"),
      notes: z.string().nullable().optional().describe("Optional notes about the meal"),
    })
    .merge(optionalNutritionSchema),
  outputSchema: z.object({
    success: z.boolean(),
    mealId: z.string(),
    message: z.string(),
    nutrition: z.object({
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
      fiber_g: z.number().nullable(),
      sugar_g: z.number().nullable(),
      sodium_mg: z.number().nullable(),
    }),
  }),
  execute: async ({ context }) => {
    const mealId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Build full nutrition, defaulting missing values
    const nutrition: FullNutrition = {
      ...DEFAULT_NUTRITION,
      calories: context.calories ?? 0,
      protein: context.protein ?? 0,
      carbs: context.carbs ?? 0,
      fat: context.fat ?? 0,
      fiber_g: context.fiber_g ?? null,
      sugar_g: context.sugar_g ?? null,
      sugar_alcohols_g: context.sugar_alcohols_g ?? null,
      net_carbs: context.net_carbs ?? null,
      cholesterol_mg: context.cholesterol_mg ?? null,
      saturated_fat_g: context.saturated_fat_g ?? null,
      trans_fat_g: context.trans_fat_g ?? null,
      monounsaturated_fat_g: context.monounsaturated_fat_g ?? null,
      polyunsaturated_fat_g: context.polyunsaturated_fat_g ?? null,
      omega_3_g: context.omega_3_g ?? null,
      omega_6_g: context.omega_6_g ?? null,
      vitamin_a_ug: context.vitamin_a_ug ?? null,
      vitamin_c_mg: context.vitamin_c_mg ?? null,
      vitamin_d_ug: context.vitamin_d_ug ?? null,
      vitamin_e_mg: context.vitamin_e_mg ?? null,
      vitamin_k_ug: context.vitamin_k_ug ?? null,
      thiamin_mg: context.thiamin_mg ?? null,
      riboflavin_mg: context.riboflavin_mg ?? null,
      niacin_mg: context.niacin_mg ?? null,
      vitamin_b6_mg: context.vitamin_b6_mg ?? null,
      vitamin_b12_ug: context.vitamin_b12_ug ?? null,
      folate_ug: context.folate_ug ?? null,
      choline_mg: context.choline_mg ?? null,
      calcium_mg: context.calcium_mg ?? null,
      iron_mg: context.iron_mg ?? null,
      magnesium_mg: context.magnesium_mg ?? null,
      phosphorus_mg: context.phosphorus_mg ?? null,
      potassium_mg: context.potassium_mg ?? null,
      sodium_mg: context.sodium_mg ?? null,
      zinc_mg: context.zinc_mg ?? null,
      copper_mg: context.copper_mg ?? null,
      manganese_mg: context.manganese_mg ?? null,
      selenium_ug: context.selenium_ug ?? null,
    };

    await addMealLog({
      id: mealId,
      user_id: context.userId,
      food_id: context.foodId ?? null,
      food_name: context.foodName,
      quantity: context.quantity,
      unit: context.unit,
      meal_type: context.mealType,
      logged_at: now,
      notes: context.notes ?? null,
      ...nutrition,
    });

    return {
      success: true,
      mealId,
      message: `Logged ${context.quantity} ${context.unit} of ${context.foodName} (${nutrition.calories} cal)`,
      nutrition: {
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        fiber_g: nutrition.fiber_g,
        sugar_g: nutrition.sugar_g,
        sodium_mg: nutrition.sodium_mg,
      },
    };
  },
});

// Helper to calculate percent of goal
function calcPercent(consumed: number, goal: number | undefined): number | null {
  if (goal === undefined || goal === 0) return null;
  return Math.round((consumed / goal) * 100);
}

// Helper to generate status for a nutrient
function nutrientStatus(
  consumed: number,
  goal: number | undefined,
  isMaximum: boolean = false
): string | null {
  if (goal === undefined) return null;
  const percent = Math.round((consumed / goal) * 100);
  const remaining = goal - consumed;

  if (isMaximum) {
    // For sodium/sugar - staying under is good
    if (consumed > goal) return `Over by ${Math.abs(remaining).toFixed(0)}`;
    if (percent >= 90) return `${remaining.toFixed(0)} left (${percent}% of max)`;
    return `${remaining.toFixed(0)} left (${percent}% of max)`;
  } else {
    // For calories/protein/carbs/fat/fiber - hitting target is good
    if (percent >= 100) return `Goal reached (${percent}%)`;
    if (percent >= 75) return `Almost there! ${remaining.toFixed(0)} to go`;
    return `${remaining.toFixed(0)} to go (${percent}%)`;
  }
}

// Goals output schema
const goalsOutputSchema = z.object({
  calories: z.number(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  fiber_g: z.number().nullable(),
  sugar_g: z.number().nullable(),
  sodium_mg: z.number().nullable(),
  net_carbs: z.number().nullable(),
  saturated_fat_g: z.number().nullable(),
  cholesterol_mg: z.number().nullable(),
});

// Progress schema for each nutrient
const progressSchema = z.object({
  percent: z.number().nullable(),
  status: z.string().nullable(),
});

export const getDailySummary = createTool({
  id: "get_daily_summary",
  description:
    "Get a summary of all meals logged for a specific day including total calories, macros, fiber, sugar, sodium, and progress toward goals.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format. Defaults to today."),
  }),
  outputSchema: z.object({
    date: z.string(),
    mealCount: z.number(),
    meals: z.array(mealOutputSchema),
    totals: z.object({
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
      fiber_g: z.number(),
      sugar_g: z.number(),
      sodium_mg: z.number(),
      net_carbs: z.number(),
      saturated_fat_g: z.number(),
      cholesterol_mg: z.number(),
    }),
    goals: goalsOutputSchema.nullable(),
    remaining: goalsOutputSchema.nullable(),
    progress: z
      .object({
        calories: progressSchema,
        protein: progressSchema,
        carbs: progressSchema,
        fat: progressSchema,
        fiber_g: progressSchema,
        sugar_g: progressSchema,
        sodium_mg: progressSchema,
        net_carbs: progressSchema,
        saturated_fat_g: progressSchema,
        cholesterol_mg: progressSchema,
      })
      .nullable(),
  }),
  execute: async ({ context }) => {
    const date = context.date ?? new Date().toISOString().split("T")[0];
    const meals = await getMealsByDate(context.userId, date!);
    const goals = await getUserGoals(context.userId);

    // Calculate totals for all tracked nutrients
    const totals = {
      calories: meals.reduce((sum, m) => sum + m.calories, 0),
      protein: meals.reduce((sum, m) => sum + m.protein, 0),
      carbs: meals.reduce((sum, m) => sum + m.carbs, 0),
      fat: meals.reduce((sum, m) => sum + m.fat, 0),
      fiber_g: meals.reduce((sum, m) => sum + (m.fiber_g ?? 0), 0),
      sugar_g: meals.reduce((sum, m) => sum + (m.sugar_g ?? 0), 0),
      sodium_mg: meals.reduce((sum, m) => sum + (m.sodium_mg ?? 0), 0),
      net_carbs: meals.reduce((sum, m) => sum + (m.net_carbs ?? 0), 0),
      saturated_fat_g: meals.reduce((sum, m) => sum + (m.saturated_fat_g ?? 0), 0),
      cholesterol_mg: meals.reduce((sum, m) => sum + (m.cholesterol_mg ?? 0), 0),
    };

    // Build goals object with new field names
    const goalsOutput = goals
      ? {
          calories: goals.calories ?? 0,
          protein: goals.protein ?? null,
          carbs: goals.carbs ?? null,
          fat: goals.fat ?? null,
          fiber_g: goals.fiber_g ?? null,
          sugar_g: goals.sugar_g ?? null,
          sodium_mg: goals.sodium_mg ?? null,
          net_carbs: goals.net_carbs ?? null,
          saturated_fat_g: goals.saturated_fat_g ?? null,
          cholesterol_mg: goals.cholesterol_mg ?? null,
        }
      : null;

    // Calculate remaining for each goal
    const remaining = goalsOutput
      ? {
          calories: goalsOutput.calories - totals.calories,
          protein: goalsOutput.protein !== null ? goalsOutput.protein - totals.protein : null,
          carbs: goalsOutput.carbs !== null ? goalsOutput.carbs - totals.carbs : null,
          fat: goalsOutput.fat !== null ? goalsOutput.fat - totals.fat : null,
          fiber_g: goalsOutput.fiber_g !== null ? goalsOutput.fiber_g - totals.fiber_g : null,
          sugar_g: goalsOutput.sugar_g !== null ? goalsOutput.sugar_g - totals.sugar_g : null,
          sodium_mg: goalsOutput.sodium_mg !== null ? goalsOutput.sodium_mg - totals.sodium_mg : null,
          net_carbs: goalsOutput.net_carbs !== null ? goalsOutput.net_carbs - totals.net_carbs : null,
          saturated_fat_g: goalsOutput.saturated_fat_g !== null ? goalsOutput.saturated_fat_g - totals.saturated_fat_g : null,
          cholesterol_mg: goalsOutput.cholesterol_mg !== null ? goalsOutput.cholesterol_mg - totals.cholesterol_mg : null,
        }
      : null;

    // Calculate progress for each goal
    const progress = goals
      ? {
          calories: {
            percent: calcPercent(totals.calories, goals.calories) ?? 0,
            status: nutrientStatus(totals.calories, goals.calories) ?? "",
          },
          protein: {
            percent: calcPercent(totals.protein, goals.protein),
            status: nutrientStatus(totals.protein, goals.protein),
          },
          carbs: {
            percent: calcPercent(totals.carbs, goals.carbs),
            status: nutrientStatus(totals.carbs, goals.carbs),
          },
          fat: {
            percent: calcPercent(totals.fat, goals.fat),
            status: nutrientStatus(totals.fat, goals.fat),
          },
          fiber_g: {
            percent: calcPercent(totals.fiber_g, goals.fiber_g),
            status: nutrientStatus(totals.fiber_g, goals.fiber_g),
          },
          sugar_g: {
            percent: calcPercent(totals.sugar_g, goals.sugar_g),
            status: nutrientStatus(totals.sugar_g, goals.sugar_g, true), // Maximum
          },
          sodium_mg: {
            percent: calcPercent(totals.sodium_mg, goals.sodium_mg),
            status: nutrientStatus(totals.sodium_mg, goals.sodium_mg, true), // Maximum
          },
          net_carbs: {
            percent: calcPercent(totals.net_carbs, goals.net_carbs),
            status: nutrientStatus(totals.net_carbs, goals.net_carbs),
          },
          saturated_fat_g: {
            percent: calcPercent(totals.saturated_fat_g, goals.saturated_fat_g),
            status: nutrientStatus(totals.saturated_fat_g, goals.saturated_fat_g, true), // Maximum
          },
          cholesterol_mg: {
            percent: calcPercent(totals.cholesterol_mg, goals.cholesterol_mg),
            status: nutrientStatus(totals.cholesterol_mg, goals.cholesterol_mg, true), // Maximum
          },
        }
      : null;

    return {
      date: date!,
      mealCount: meals.length,
      meals: meals.map((m) => ({
        id: m.id,
        foodName: m.food_name,
        quantity: m.quantity,
        unit: m.unit,
        mealType: m.meal_type,
        loggedAt: m.logged_at,
        notes: m.notes,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        fiber_g: m.fiber_g,
        sugar_g: m.sugar_g,
        net_carbs: m.net_carbs,
        sodium_mg: m.sodium_mg,
        saturated_fat_g: m.saturated_fat_g,
        cholesterol_mg: m.cholesterol_mg,
      })),
      totals,
      goals: goalsOutput,
      remaining,
      progress,
    };
  },
});

export const getMealHistoryTool = createTool({
  id: "get_meal_history",
  description:
    "Get past meal entries for a user, optionally filtered by date range. Returns full nutrition data.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
    endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
    limit: z.number().int().positive().max(100).default(20).describe("Maximum number of results"),
  }),
  outputSchema: z.object({
    meals: z.array(mealOutputSchema),
    count: z.number(),
  }),
  execute: async ({ context }) => {
    const meals = await getMealHistory(
      context.userId,
      context.startDate,
      context.endDate,
      context.limit
    );

    return {
      meals: meals.map((m) => ({
        id: m.id,
        foodName: m.food_name,
        quantity: m.quantity,
        unit: m.unit,
        mealType: m.meal_type,
        loggedAt: m.logged_at,
        notes: m.notes,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        fiber_g: m.fiber_g,
        sugar_g: m.sugar_g,
        net_carbs: m.net_carbs,
        sodium_mg: m.sodium_mg,
        saturated_fat_g: m.saturated_fat_g,
        cholesterol_mg: m.cholesterol_mg,
      })),
      count: meals.length,
    };
  },
});

export const searchMeals = createTool({
  id: "search_meals",
  description:
    "Search through past meal entries using semantic search. Useful for finding specific foods the user has eaten before.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    query: z.string().describe("Search query (e.g., 'chicken dinner', 'breakfast with eggs')"),
    limit: z.number().int().positive().max(50).default(10).describe("Maximum number of results"),
  }),
  outputSchema: z.object({
    meals: z.array(mealOutputSchema),
    count: z.number(),
  }),
  execute: async ({ context }) => {
    const meals = await searchMealLogs(context.userId, context.query, context.limit);

    return {
      meals: meals.map((m) => ({
        id: m.id,
        foodName: m.food_name,
        quantity: m.quantity,
        unit: m.unit,
        mealType: m.meal_type,
        loggedAt: m.logged_at,
        notes: m.notes,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        fiber_g: m.fiber_g,
        sugar_g: m.sugar_g,
        net_carbs: m.net_carbs,
        sodium_mg: m.sodium_mg,
        saturated_fat_g: m.saturated_fat_g,
        cholesterol_mg: m.cholesterol_mg,
      })),
      count: meals.length,
    };
  },
});
