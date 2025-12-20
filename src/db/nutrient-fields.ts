/**
 * Single Source of Truth for Nutrition Field Definitions
 *
 * All nutrition-related schemas (foods, meal_logs, user_goals) import from here.
 * This ensures consistency across the entire application.
 */

import { z } from "zod";

/**
 * Core macronutrients (required, always tracked)
 */
export const coreMacrosSchema = z.object({
  calories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
});

/**
 * Extended macronutrients (optional, nullable)
 */
export const extendedMacrosSchema = z.object({
  fiber_g: z.number().min(0).nullable(),
  sugar_g: z.number().min(0).nullable(),
  sugar_alcohols_g: z.number().min(0).nullable(),
  net_carbs: z.number().nullable(), // Calculated: carbs - fiber - sugar_alcohols
  cholesterol_mg: z.number().min(0).nullable(),
  saturated_fat_g: z.number().min(0).nullable(),
  trans_fat_g: z.number().min(0).nullable(),
  monounsaturated_fat_g: z.number().min(0).nullable(),
  polyunsaturated_fat_g: z.number().min(0).nullable(),
  omega_3_g: z.number().min(0).nullable(),
  omega_6_g: z.number().min(0).nullable(),
});

/**
 * Vitamins (all nullable)
 */
export const vitaminsSchema = z.object({
  vitamin_a_ug: z.number().min(0).nullable(), // RAE (Retinol Activity Equivalents)
  vitamin_c_mg: z.number().min(0).nullable(),
  vitamin_d_ug: z.number().min(0).nullable(),
  vitamin_e_mg: z.number().min(0).nullable(),
  vitamin_k_ug: z.number().min(0).nullable(),
  thiamin_mg: z.number().min(0).nullable(), // B1
  riboflavin_mg: z.number().min(0).nullable(), // B2
  niacin_mg: z.number().min(0).nullable(), // B3
  vitamin_b6_mg: z.number().min(0).nullable(),
  vitamin_b12_ug: z.number().min(0).nullable(),
  folate_ug: z.number().min(0).nullable(),
  choline_mg: z.number().min(0).nullable(),
});

/**
 * Minerals (all nullable)
 */
export const mineralsSchema = z.object({
  calcium_mg: z.number().min(0).nullable(),
  iron_mg: z.number().min(0).nullable(),
  magnesium_mg: z.number().min(0).nullable(),
  phosphorus_mg: z.number().min(0).nullable(),
  potassium_mg: z.number().min(0).nullable(),
  sodium_mg: z.number().min(0).nullable(),
  zinc_mg: z.number().min(0).nullable(),
  copper_mg: z.number().min(0).nullable(),
  manganese_mg: z.number().min(0).nullable(),
  selenium_ug: z.number().min(0).nullable(),
});

/**
 * Complete nutrition schema (all fields combined)
 * Use this for foods and meal_logs storage
 */
export const fullNutritionSchema = coreMacrosSchema
  .merge(extendedMacrosSchema)
  .merge(vitaminsSchema)
  .merge(mineralsSchema);

/**
 * Optional nutrition schema (all fields optional)
 * Use this for API inputs where only some fields are provided
 */
export const optionalNutritionSchema = z.object({
  // Core macros (optional for input, will default to 0)
  calories: z.number().min(0).optional(),
  protein: z.number().min(0).optional(),
  carbs: z.number().min(0).optional(),
  fat: z.number().min(0).optional(),

  // Extended macros
  fiber_g: z.number().min(0).optional(),
  sugar_g: z.number().min(0).optional(),
  sugar_alcohols_g: z.number().min(0).optional(),
  net_carbs: z.number().optional(),
  cholesterol_mg: z.number().min(0).optional(),
  saturated_fat_g: z.number().min(0).optional(),
  trans_fat_g: z.number().min(0).optional(),
  monounsaturated_fat_g: z.number().min(0).optional(),
  polyunsaturated_fat_g: z.number().min(0).optional(),
  omega_3_g: z.number().min(0).optional(),
  omega_6_g: z.number().min(0).optional(),

  // Vitamins
  vitamin_a_ug: z.number().min(0).optional(),
  vitamin_c_mg: z.number().min(0).optional(),
  vitamin_d_ug: z.number().min(0).optional(),
  vitamin_e_mg: z.number().min(0).optional(),
  vitamin_k_ug: z.number().min(0).optional(),
  thiamin_mg: z.number().min(0).optional(),
  riboflavin_mg: z.number().min(0).optional(),
  niacin_mg: z.number().min(0).optional(),
  vitamin_b6_mg: z.number().min(0).optional(),
  vitamin_b12_ug: z.number().min(0).optional(),
  folate_ug: z.number().min(0).optional(),
  choline_mg: z.number().min(0).optional(),

  // Minerals
  calcium_mg: z.number().min(0).optional(),
  iron_mg: z.number().min(0).optional(),
  magnesium_mg: z.number().min(0).optional(),
  phosphorus_mg: z.number().min(0).optional(),
  potassium_mg: z.number().min(0).optional(),
  sodium_mg: z.number().min(0).optional(),
  zinc_mg: z.number().min(0).optional(),
  copper_mg: z.number().min(0).optional(),
  manganese_mg: z.number().min(0).optional(),
  selenium_ug: z.number().min(0).optional(),
});

/**
 * Nutrition goals schema (all optional positive numbers)
 * For user goal setting - only set goals for nutrients you want to track
 */
export const nutritionGoalsSchema = z.object({
  // Core macros
  calories: z.number().positive().optional(),
  protein: z.number().positive().optional(),
  carbs: z.number().positive().optional(),
  fat: z.number().positive().optional(),

  // Extended macros
  fiber_g: z.number().positive().optional(),
  sugar_g: z.number().positive().optional(), // Maximum
  net_carbs: z.number().positive().optional(), // For keto users
  cholesterol_mg: z.number().positive().optional(), // Maximum
  saturated_fat_g: z.number().positive().optional(), // Maximum
  sodium_mg: z.number().positive().optional(), // Maximum
  omega_3_g: z.number().positive().optional(),
  omega_6_g: z.number().positive().optional(),

  // Vitamins (key ones for tracking)
  vitamin_a_ug: z.number().positive().optional(),
  vitamin_c_mg: z.number().positive().optional(),
  vitamin_d_ug: z.number().positive().optional(),
  vitamin_e_mg: z.number().positive().optional(),
  vitamin_k_ug: z.number().positive().optional(),
  vitamin_b12_ug: z.number().positive().optional(),
  folate_ug: z.number().positive().optional(),

  // Minerals (key ones for tracking)
  calcium_mg: z.number().positive().optional(),
  iron_mg: z.number().positive().optional(),
  magnesium_mg: z.number().positive().optional(),
  potassium_mg: z.number().positive().optional(),
  zinc_mg: z.number().positive().optional(),
});

// Type exports
export type CoreMacros = z.infer<typeof coreMacrosSchema>;
export type ExtendedMacros = z.infer<typeof extendedMacrosSchema>;
export type Vitamins = z.infer<typeof vitaminsSchema>;
export type Minerals = z.infer<typeof mineralsSchema>;
export type FullNutrition = z.infer<typeof fullNutritionSchema>;
export type OptionalNutrition = z.infer<typeof optionalNutritionSchema>;
export type NutritionGoals = z.infer<typeof nutritionGoalsSchema>;

/**
 * List of all nutrient field keys for iteration
 */
export const NUTRIENT_KEYS = [
  // Core macros
  "calories",
  "protein",
  "carbs",
  "fat",
  // Extended macros
  "fiber_g",
  "sugar_g",
  "sugar_alcohols_g",
  "net_carbs",
  "cholesterol_mg",
  "saturated_fat_g",
  "trans_fat_g",
  "monounsaturated_fat_g",
  "polyunsaturated_fat_g",
  "omega_3_g",
  "omega_6_g",
  // Vitamins
  "vitamin_a_ug",
  "vitamin_c_mg",
  "vitamin_d_ug",
  "vitamin_e_mg",
  "vitamin_k_ug",
  "thiamin_mg",
  "riboflavin_mg",
  "niacin_mg",
  "vitamin_b6_mg",
  "vitamin_b12_ug",
  "folate_ug",
  "choline_mg",
  // Minerals
  "calcium_mg",
  "iron_mg",
  "magnesium_mg",
  "phosphorus_mg",
  "potassium_mg",
  "sodium_mg",
  "zinc_mg",
  "copper_mg",
  "manganese_mg",
  "selenium_ug",
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/**
 * Default nutrition values (all zeros/nulls)
 * Use for initializing new records or filling missing values
 */
export const DEFAULT_NUTRITION: FullNutrition = {
  // Core macros
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  // Extended macros
  fiber_g: null,
  sugar_g: null,
  sugar_alcohols_g: null,
  net_carbs: null,
  cholesterol_mg: null,
  saturated_fat_g: null,
  trans_fat_g: null,
  monounsaturated_fat_g: null,
  polyunsaturated_fat_g: null,
  omega_3_g: null,
  omega_6_g: null,
  // Vitamins
  vitamin_a_ug: null,
  vitamin_c_mg: null,
  vitamin_d_ug: null,
  vitamin_e_mg: null,
  vitamin_k_ug: null,
  thiamin_mg: null,
  riboflavin_mg: null,
  niacin_mg: null,
  vitamin_b6_mg: null,
  vitamin_b12_ug: null,
  folate_ug: null,
  choline_mg: null,
  // Minerals
  calcium_mg: null,
  iron_mg: null,
  magnesium_mg: null,
  phosphorus_mg: null,
  potassium_mg: null,
  sodium_mg: null,
  zinc_mg: null,
  copper_mg: null,
  manganese_mg: null,
  selenium_ug: null,
};

/**
 * Convert nutrition values for LanceDB storage
 * LanceDB doesn't support null - use 0 for missing values
 */
export function toStorageNutrition(
  nutrition: Partial<FullNutrition>
): Record<NutrientKey, number> {
  const result: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    result[key] = nutrition[key] ?? 0;
  }
  return result as Record<NutrientKey, number>;
}

/**
 * Convert nutrition values from LanceDB storage
 * Convert 0 back to null for optional nutrients
 */
export function fromStorageNutrition(
  stored: Record<string, number>
): FullNutrition {
  const coreMacros = ["calories", "protein", "carbs", "fat"];

  const result: Record<string, number | null> = {};
  for (const key of NUTRIENT_KEYS) {
    const value = stored[key] ?? 0;
    // Core macros stay as-is, others convert 0 to null
    result[key] = coreMacros.includes(key) ? value : value === 0 ? null : value;
  }
  return result as FullNutrition;
}
