import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  addMealLog,
  getMealsByDate,
  getMealHistory,
  searchMealLogs,
  getUserGoals,
} from "../../db";
import { mealTypeSchema } from "../../db/schemas";

const mealTypeEnum = z.enum(["breakfast", "lunch", "dinner", "snack"]);

export const logMeal = createTool({
  id: "log_meal",
  description:
    "Log a meal entry with nutritional information. Records what the user ate including calories and macros.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    foodName: z.string().describe("Name of the food eaten"),
    quantity: z.number().positive().describe("Quantity consumed"),
    unit: z.string().default("serving").describe("Unit of measurement (e.g., 'serving', 'g', 'oz')"),
    mealType: mealTypeEnum.describe("Type of meal: breakfast, lunch, dinner, or snack"),
    calories: z.number().min(0).describe("Calories in this meal"),
    protein: z.number().min(0).default(0).describe("Protein in grams"),
    carbs: z.number().min(0).default(0).describe("Carbohydrates in grams"),
    fat: z.number().min(0).default(0).describe("Fat in grams"),
    notes: z.string().nullable().optional().describe("Optional notes about the meal"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    mealId: z.string(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const mealId = crypto.randomUUID();
    const now = new Date().toISOString();

    await addMealLog({
      id: mealId,
      user_id: context.userId,
      food_id: null,
      food_name: context.foodName,
      quantity: context.quantity,
      unit: context.unit,
      calories: context.calories,
      protein: context.protein,
      carbs: context.carbs,
      fat: context.fat,
      meal_type: context.mealType,
      logged_at: now,
      notes: context.notes ?? null,
    });

    return {
      success: true,
      mealId,
      message: `Logged ${context.quantity} ${context.unit} of ${context.foodName} (${context.calories} cal)`,
    };
  },
});

// Helper to calculate percent of goal
function calcPercent(consumed: number, goal: number | null): number | null {
  if (goal === null || goal === 0) return null;
  return Math.round((consumed / goal) * 100);
}

// Helper to generate status for a nutrient
function nutrientStatus(
  consumed: number,
  goal: number | null,
  isMaximum: boolean = false
): string | null {
  if (goal === null) return null;
  const percent = Math.round((consumed / goal) * 100);
  const remaining = goal - consumed;

  if (isMaximum) {
    // For sodium/sugar - staying under is good
    if (consumed > goal) return `⚠️ Over by ${Math.abs(remaining).toFixed(0)}`;
    if (percent >= 90) return `⚡ ${remaining.toFixed(0)} left (${percent}% of max)`;
    return `✓ ${remaining.toFixed(0)} left (${percent}% of max)`;
  } else {
    // For calories/protein/carbs/fat/fiber - hitting target is good
    if (percent >= 100) return `✓ Goal reached (${percent}%)`;
    if (percent >= 75) return `📈 Almost there! ${remaining.toFixed(0)} to go`;
    return `${remaining.toFixed(0)} to go (${percent}%)`;
  }
}

export const getDailySummary = createTool({
  id: "get_daily_summary",
  description:
    "Get a summary of all meals logged for a specific day including total calories and macros, plus progress toward goals.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format. Defaults to today."),
  }),
  outputSchema: z.object({
    date: z.string(),
    totalCalories: z.number(),
    totalProtein: z.number(),
    totalCarbs: z.number(),
    totalFat: z.number(),
    mealCount: z.number(),
    meals: z.array(
      z.object({
        id: z.string(),
        foodName: z.string(),
        quantity: z.number(),
        unit: z.string(),
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number(),
        mealType: z.string(),
        loggedAt: z.string(),
      })
    ),
    goals: z
      .object({
        calories: z.number(),
        protein: z.number().nullable(),
        carbs: z.number().nullable(),
        fat: z.number().nullable(),
        fiber: z.number().nullable(),
        sodium: z.number().nullable(),
        sugar: z.number().nullable(),
      })
      .nullable(),
    remaining: z
      .object({
        calories: z.number(),
        protein: z.number().nullable(),
        carbs: z.number().nullable(),
        fat: z.number().nullable(),
        fiber: z.number().nullable(),
        sodium: z.number().nullable(),
        sugar: z.number().nullable(),
      })
      .nullable(),
    progress: z
      .object({
        calories: z.object({ percent: z.number(), status: z.string() }),
        protein: z.object({ percent: z.number().nullable(), status: z.string().nullable() }),
        carbs: z.object({ percent: z.number().nullable(), status: z.string().nullable() }),
        fat: z.object({ percent: z.number().nullable(), status: z.string().nullable() }),
        fiber: z.object({ percent: z.number().nullable(), status: z.string().nullable() }),
        sodium: z.object({ percent: z.number().nullable(), status: z.string().nullable() }),
        sugar: z.object({ percent: z.number().nullable(), status: z.string().nullable() }),
      })
      .nullable()
      .describe("Progress percentages and status messages for each goal"),
  }),
  execute: async ({ context }) => {
    const date = context.date ?? new Date().toISOString().split("T")[0];
    const meals = await getMealsByDate(context.userId, date!);
    const goals = await getUserGoals(context.userId);

    const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
    const totalProtein = meals.reduce((sum, m) => sum + m.protein, 0);
    const totalCarbs = meals.reduce((sum, m) => sum + m.carbs, 0);
    const totalFat = meals.reduce((sum, m) => sum + m.fat, 0);
    // Note: fiber/sodium/sugar tracking would require those fields in meal_logs
    // For now, they're tracked at the goal level but not summed from meals

    const remaining = goals
      ? {
          calories: goals.calories - totalCalories,
          protein: goals.protein ? goals.protein - totalProtein : null,
          carbs: goals.carbs ? goals.carbs - totalCarbs : null,
          fat: goals.fat ? goals.fat - totalFat : null,
          fiber: goals.fiber, // Can't calculate remaining without meal-level fiber tracking
          sodium: goals.sodium,
          sugar: goals.sugar,
        }
      : null;

    const progress = goals
      ? {
          calories: {
            percent: calcPercent(totalCalories, goals.calories) ?? 0,
            status: nutrientStatus(totalCalories, goals.calories) ?? "",
          },
          protein: {
            percent: calcPercent(totalProtein, goals.protein),
            status: nutrientStatus(totalProtein, goals.protein),
          },
          carbs: {
            percent: calcPercent(totalCarbs, goals.carbs),
            status: nutrientStatus(totalCarbs, goals.carbs),
          },
          fat: {
            percent: calcPercent(totalFat, goals.fat),
            status: nutrientStatus(totalFat, goals.fat),
          },
          // fiber/sodium/sugar need meal-level tracking to show progress
          fiber: { percent: null, status: goals.fiber ? "Set goal, tracking not yet available" : null },
          sodium: { percent: null, status: goals.sodium ? "Set goal, tracking not yet available" : null },
          sugar: { percent: null, status: goals.sugar ? "Set goal, tracking not yet available" : null },
        }
      : null;

    return {
      date: date!,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFat,
      mealCount: meals.length,
      meals: meals.map((m) => ({
        id: m.id,
        foodName: m.food_name,
        quantity: m.quantity,
        unit: m.unit,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        mealType: m.meal_type,
        loggedAt: m.logged_at,
      })),
      goals: goals
        ? {
            calories: goals.calories,
            protein: goals.protein,
            carbs: goals.carbs,
            fat: goals.fat,
            fiber: goals.fiber,
            sodium: goals.sodium,
            sugar: goals.sugar,
          }
        : null,
      remaining,
      progress,
    };
  },
});

export const getMealHistoryTool = createTool({
  id: "get_meal_history",
  description:
    "Get past meal entries for a user, optionally filtered by date range.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
    endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
    limit: z.number().int().positive().max(100).default(20).describe("Maximum number of results"),
  }),
  outputSchema: z.object({
    meals: z.array(
      z.object({
        id: z.string(),
        foodName: z.string(),
        quantity: z.number(),
        unit: z.string(),
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number(),
        mealType: z.string(),
        loggedAt: z.string(),
        notes: z.string().nullable(),
      })
    ),
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
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        mealType: m.meal_type,
        loggedAt: m.logged_at,
        notes: m.notes,
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
    meals: z.array(
      z.object({
        id: z.string(),
        foodName: z.string(),
        quantity: z.number(),
        unit: z.string(),
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number(),
        mealType: z.string(),
        loggedAt: z.string(),
        notes: z.string().nullable(),
      })
    ),
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
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        mealType: m.meal_type,
        loggedAt: m.logged_at,
        notes: m.notes,
      })),
      count: meals.length,
    };
  },
});
