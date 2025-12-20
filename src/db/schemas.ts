import { z } from "zod";

// Food sources
export const foodSourceSchema = z.enum(["openfoodfacts", "usda", "custom"]);

// Meal types
export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

// Audit log roles
export const auditRoleSchema = z.enum(["user", "assistant", "tool"]);

// Food input schema (for creating/updating foods)
// Note: using snake_case for LanceDB compatibility
export const foodInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  calories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
  serving_size: z.string(),
  source: foodSourceSchema,
});

// Meal log input schema
export const mealLogInputSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  food_id: z.string().nullable(),
  food_name: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string(),
  calories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
  meal_type: mealTypeSchema,
  logged_at: z.string().datetime(),
  notes: z.string().nullable(),
});

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

// User goals schema - flexible nutrition targets
export const userGoalsSchema = z.object({
  user_id: z.string(),
  calories: z.number().positive(),
  protein: z.number().positive().nullable(),
  carbs: z.number().positive().nullable(),       // Can be total or net carbs (user preference)
  fat: z.number().positive().nullable(),
  fiber: z.number().positive().nullable(),       // Daily fiber target (RDA: 25-38g)
  sodium: z.number().positive().nullable(),      // Daily sodium max (RDA: <2300mg)
  sugar: z.number().positive().nullable(),       // Daily sugar max (RDA: <50g added sugar)
  updated_at: z.string().datetime(),
});

// Tool input schemas for validation (these can stay camelCase as they're API-facing)
export const searchFoodInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
});

export const lookupBarcodeInputSchema = z.object({
  barcode: z.string().min(1),
});

export const logMealInputSchema = z.object({
  userId: z.string(),
  foodName: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().default("serving"),
  mealType: mealTypeSchema,
  calories: z.number().min(0).optional(),
  protein: z.number().min(0).optional(),
  carbs: z.number().min(0).optional(),
  fat: z.number().min(0).optional(),
  notes: z.string().nullable().optional(),
});

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

export const setUserGoalsInputSchema = z.object({
  userId: z.string(),
  calories: z.number().positive(),
  protein: z.number().positive().optional(),
  carbs: z.number().positive().optional(),
  fat: z.number().positive().optional(),
  fiber: z.number().positive().optional(),
  sodium: z.number().positive().optional(),
  sugar: z.number().positive().optional(),
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
