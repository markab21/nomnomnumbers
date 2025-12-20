import { z } from "zod";
import {
  fullNutritionSchema,
  optionalNutritionSchema,
  nutritionGoalsSchema,
} from "./nutrient-fields";

// Food sources
export const foodSourceSchema = z.enum(["openfoodfacts", "usda", "usda-local", "custom"]);

// Meal types
export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

// Audit log roles
export const auditRoleSchema = z.enum(["user", "assistant", "tool"]);

// Food input schema (for creating/updating foods)
// Note: using snake_case for LanceDB compatibility
// Includes full nutrition from shared schema
export const foodInputSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    brand: z.string().nullable(),
    barcode: z.string().nullable(),
    serving_size: z.string(),
    serving_grams: z.number().nullable(),
    source: foodSourceSchema,
  })
  .merge(fullNutritionSchema);

// Meal log input schema
// Includes full nutrition for historical tracking
export const mealLogInputSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    food_id: z.string().nullable(),
    food_name: z.string().min(1),
    quantity: z.number().positive(),
    unit: z.string(),
    meal_type: mealTypeSchema,
    logged_at: z.string().datetime(),
    notes: z.string().nullable(),
  })
  .merge(fullNutritionSchema);

// Audit log input schema
export const auditLogInputSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  session_id: z.string(),
  role: auditRoleSchema,
  content: z.string(),
  tool_name: z.string().nullable(),
  tool_input: z.string().nullable(),
  tool_output: z.string().nullable(),
  timestamp: z.string().datetime(),
});

// User goals schema - full nutrition targets
// All goals are optional except calories
export const userGoalsSchema = z
  .object({
    user_id: z.string(),
    updated_at: z.string().datetime(),
  })
  .merge(nutritionGoalsSchema)
  .refine((data) => data.calories !== undefined, {
    message: "Calories goal is required",
  });

// Tool input schemas for validation (these can stay camelCase as they're API-facing)
export const searchFoodInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
});

export const lookupBarcodeInputSchema = z.object({
  barcode: z.string().min(1),
});

// Log meal input - includes all optional nutrition fields
export const logMealInputSchema = z
  .object({
    userId: z.string(),
    foodId: z.string().optional(), // If provided, can lookup nutrition from food
    foodName: z.string().min(1),
    quantity: z.number().positive(),
    unit: z.string().default("serving"),
    mealType: mealTypeSchema,
    notes: z.string().nullable().optional(),
  })
  .merge(optionalNutritionSchema);

export const getDailySummaryInputSchema = z.object({
  userId: z.string(),
  date: z.string().optional(), // ISO date string, defaults to today
});

export const getMealHistoryInputSchema = z.object({
  userId: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});

// Set user goals input - all nutrition goals optional except calories
export const setUserGoalsInputSchema = z
  .object({
    userId: z.string(),
  })
  .merge(nutritionGoalsSchema)
  .refine((data) => data.calories !== undefined, {
    message: "Calories goal is required",
  });

export const getUserGoalsInputSchema = z.object({
  userId: z.string(),
});

export const searchMealsInputSchema = z.object({
  userId: z.string(),
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
});

export const logInteractionInputSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  role: auditRoleSchema,
  content: z.string(),
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  toolOutput: z.string().optional(),
});

export const searchAuditLogInputSchema = z.object({
  userId: z.string(),
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).default(20),
});

// Type exports from schemas
export type FoodInput = z.infer<typeof foodInputSchema>;
export type MealLogInput = z.infer<typeof mealLogInputSchema>;
export type AuditLogInput = z.infer<typeof auditLogInputSchema>;
export type UserGoals = z.infer<typeof userGoalsSchema>;
