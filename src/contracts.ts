import { z } from "zod";

const finiteNumber = z.number().finite();
const nullableFiniteNumber = finiteNumber.nullable();
const nonNegativeInt = z.number().int().nonnegative();
const stringValue = z.string();

export const AgentHintSchema = z.object({
  action: stringValue,
  command: stringValue,
  confidence: finiteNumber.optional(),
}).strict();

const macroTargetsShape = {
  calories: finiteNumber.optional(),
  protein: finiteNumber.optional(),
  carbs: finiteNumber.optional(),
  fat: finiteNumber.optional(),
  netCarbs: finiteNumber.optional(),
} as const;

const nutritionValueShape = {
  calories: nullableFiniteNumber,
  protein: nullableFiniteNumber,
  carbs: nullableFiniteNumber,
  fat: nullableFiniteNumber,
  netCarbs: nullableFiniteNumber.optional(),
} as const;

const extendedNutritionValueShape = {
  ...nutritionValueShape,
  fiber: nullableFiniteNumber,
  sugar: nullableFiniteNumber,
  sodium: nullableFiniteNumber,
} as const;

export const NutritionValuesSchema = z.object(nutritionValueShape).strict();
export const ExtendedNutritionValuesSchema = z.object(extendedNutritionValueShape).strict();

export const FoodOutputSchema = z.object({
  fdcId: z.number().int(),
  description: stringValue,
  brand: stringValue.nullable(),
  barcode: stringValue.nullable(),
  servingSize: stringValue.nullable(),
  ...extendedNutritionValueShape,
  source: z.literal("usda"),
}).strict();

export const CustomFoodSearchOutputSchema = z.object({
  id: stringValue,
  description: stringValue,
  brand: stringValue.nullable(),
  barcode: stringValue.nullable(),
  servingSize: stringValue.nullable(),
  ...extendedNutritionValueShape,
  source: z.literal("custom"),
}).strict();

export const CustomFoodListItemSchema = z.object({
  id: stringValue,
  name: stringValue,
  brand: stringValue.nullable(),
  barcode: stringValue.nullable(),
  servingSize: stringValue.nullable(),
  ...extendedNutritionValueShape,
  createdAt: stringValue,
}).strict();

export const RecipeOutputSchema = z.object({
  id: stringValue,
  name: stringValue,
  servingSize: stringValue.nullable(),
  ...extendedNutritionValueShape,
  createdAt: stringValue,
}).strict();

export const MealOutputSchema = z.object({
  id: stringValue,
  foodName: stringValue,
  quantity: finiteNumber,
  unit: stringValue,
  mealType: stringValue,
  loggedAt: stringValue,
  notes: stringValue.nullable(),
  ...nutritionValueShape,
  fiber: nullableFiniteNumber,
}).strict();

export const SearchPayloadSchema = z.object({
  query: stringValue,
  count: nonNegativeInt,
  results: z.array(z.union([FoodOutputSchema, CustomFoodSearchOutputSchema])),
}).strict();

export const LookupPayloadSchema = z.union([
  z.object({
    found: z.literal(false),
    barcode: stringValue,
  }).strict(),
  FoodOutputSchema.extend({
    found: z.literal(true),
  }).strict(),
  CustomFoodSearchOutputSchema.extend({
    found: z.literal(true),
  }).strict(),
]);

export const DeletePayloadSchema = z.object({
  success: z.literal(true),
  id: stringValue,
  foodName: stringValue,
}).strict();

export const EditPayloadSchema = z.object({
  success: z.literal(true),
  id: stringValue,
  foodName: stringValue,
  updated: z.array(stringValue),
}).strict();

export const LogPayloadSchema = z.object({
  success: z.literal(true),
  id: stringValue,
  foodName: stringValue,
  quantity: finiteNumber,
}).strict();

export const TotalsSchema = z.object({
  calories: finiteNumber,
  protein: finiteNumber,
  carbs: finiteNumber,
  fat: finiteNumber,
  mealCount: nonNegativeInt,
  netCarbs: finiteNumber.optional(),
}).strict();

export const TodayPayloadSchema = z.object({
  date: stringValue,
  totals: TotalsSchema,
  meals: z.array(MealOutputSchema),
  goals: z.object(macroTargetsShape).strict().nullable().optional(),
  remaining: z.object(macroTargetsShape).strict().nullable().optional(),
  hints: z.array(AgentHintSchema).optional(),
}).strict();

export const HistoryPayloadSchema = z.object({
  count: nonNegativeInt,
  offset: nonNegativeInt,
  meals: z.array(MealOutputSchema),
}).strict();

export const GoalSettingSchema = z.object({
  target: finiteNumber,
  direction: z.enum(["under", "over"]),
  tolerance: finiteNumber,
}).strict();

export const GoalsViewPayloadSchema = z.object({
  goals: z.union([
    z.null(),
    z.object({
      calories: GoalSettingSchema.optional(),
      protein: GoalSettingSchema.optional(),
      carbs: GoalSettingSchema.optional(),
      fat: GoalSettingSchema.optional(),
      netCarbs: GoalSettingSchema.optional(),
      updatedAt: stringValue,
    }).strict(),
  ]),
}).strict();

export const GoalsSetPayloadSchema = z.object({
  success: z.literal(true),
  goalsSet: z.array(stringValue),
}).strict();

export const GoalsResetPayloadSchema = z.object({
  success: z.literal(true),
}).strict();

export const ProgressMetricSchema = z.object({
  actual: finiteNumber,
  goal: finiteNumber,
  remaining: finiteNumber,
  percent: finiteNumber,
  tolerance: finiteNumber,
  band: finiteNumber,
  zone: z.enum(["met", "near", "over", "under"]),
}).strict();

export const ProgressTodaySchema = z.object({
  calories: ProgressMetricSchema.optional(),
  protein: ProgressMetricSchema.optional(),
  carbs: ProgressMetricSchema.optional(),
  fat: ProgressMetricSchema.optional(),
  netCarbs: ProgressMetricSchema.optional(),
  mealCount: nonNegativeInt,
}).strict();

export const StreakSchema = z.object({
  current: nonNegativeInt,
  best: nonNegativeInt,
  direction: z.enum(["under", "over"]).optional(),
}).strict();

export const ProgressPayloadSchema = z.object({
  date: stringValue,
  goals: z.object({
    calories: GoalSettingSchema.optional(),
    protein: GoalSettingSchema.optional(),
    carbs: GoalSettingSchema.optional(),
    fat: GoalSettingSchema.optional(),
    netCarbs: GoalSettingSchema.optional(),
  }).strict(),
  today: ProgressTodaySchema,
  streaks: z.object({
    calories: StreakSchema.optional(),
    protein: StreakSchema.optional(),
    carbs: StreakSchema.optional(),
    fat: StreakSchema.optional(),
    netCarbs: StreakSchema.optional(),
    allGoals: z.object({
      current: nonNegativeInt,
      best: nonNegativeInt,
    }).strict(),
  }).strict(),
  weeklyAvg: z.object({
    calories: finiteNumber,
    protein: finiteNumber,
    carbs: finiteNumber,
    fat: finiteNumber,
    netCarbs: finiteNumber.optional(),
    daysTracked: nonNegativeInt,
  }).strict(),
  hints: z.array(AgentHintSchema).optional(),
}).strict();

export const FoodsListPayloadSchema = z.object({
  count: nonNegativeInt,
  foods: z.array(CustomFoodListItemSchema),
}).strict();

export const FoodsAddPayloadSchema = z.object({
  success: z.literal(true),
  id: stringValue,
  name: stringValue,
}).strict();

export const FoodsDeletePayloadSchema = z.object({
  success: z.literal(true),
  id: stringValue,
  name: stringValue.nullable(),
}).strict();

export const RecipeCreatePayloadSchema = RecipeOutputSchema.extend({
  success: z.literal(true),
}).strict();

export const RecipeListPayloadSchema = z.object({
  count: nonNegativeInt,
  recipes: z.array(RecipeOutputSchema),
}).strict();

export const RecipeDeletePayloadSchema = z.object({
  success: z.literal(true),
  id: stringValue,
  name: stringValue.nullable(),
}).strict();

export const RecipeLogPayloadSchema = z.object({
  success: z.literal(true),
  recipeId: stringValue,
  mealId: stringValue,
  name: stringValue,
  multiplier: finiteNumber,
  actualNutrition: ExtendedNutritionValuesSchema.pick({
    calories: true,
    protein: true,
    carbs: true,
    fat: true,
    fiber: true,
    sugar: true,
    sodium: true,
    netCarbs: true,
  }),
  hints: z.array(AgentHintSchema).optional(),
}).strict();

export const RecipeApplySuggestionPayloadSchema = RecipeOutputSchema.extend({
  success: z.literal(true),
  suggestionId: stringValue,
  hints: z.array(AgentHintSchema).optional(),
}).strict();

export const TrendDaySchema = z.object({
  date: stringValue,
  calories: finiteNumber,
  protein: finiteNumber,
  carbs: finiteNumber,
  fat: finiteNumber,
  netCarbs: finiteNumber.optional(),
  mealCount: nonNegativeInt,
}).strict();

export const TrendsPayloadSchema = z.object({
  days: nonNegativeInt,
  period: z.object({
    from: stringValue,
    to: stringValue,
  }).strict(),
  averages: z.object({
    calories: finiteNumber,
    protein: finiteNumber,
    carbs: finiteNumber,
    fat: finiteNumber,
    netCarbs: finiteNumber.optional(),
    daysWithData: nonNegativeInt,
  }).strict(),
  daily: z.array(TrendDaySchema),
  hints: z.array(AgentHintSchema).optional(),
}).strict();

export const RecipeSuggestionSchema = z.object({
  id: stringValue,
  foods: z.tuple([stringValue, stringValue]),
  frequency: nonNegativeInt,
  suggestedName: stringValue,
  nutrition: ExtendedNutritionValuesSchema.pick({
    calories: true,
    protein: true,
    carbs: true,
    fat: true,
    fiber: true,
    sugar: true,
    sodium: true,
    netCarbs: true,
  }),
  hints: z.array(AgentHintSchema),
}).strict();

export const TrendRecipeSuggestionsPayloadSchema = z.object({
  days: nonNegativeInt,
  minOccurrences: nonNegativeInt,
  count: nonNegativeInt,
  suggestions: z.array(RecipeSuggestionSchema),
}).strict();

export const InitPayloadSchema = z.object({
  initialized: z.literal(true),
  dataDir: stringValue,
  usdaExists: z.boolean().optional(),
  usdaDownloaded: z.boolean().optional(),
  usdaError: stringValue.optional(),
}).strict();

export const ConfigUpdatePayloadSchema = z.union([
  z.object({
    success: z.literal(true),
    dataDir: stringValue,
  }).strict(),
  z.object({
    success: z.literal(true),
    usdaPath: stringValue,
  }).strict(),
  z.object({
    success: z.literal(true),
  }).strict(),
]);

export const ConfigViewPayloadSchema = z.object({
  config: z.object({
    dataDir: stringValue,
    mealDbPath: stringValue,
    usdaDbPath: stringValue,
    usdaExists: z.boolean(),
  }).strict(),
  paths: z.object({
    configDir: stringValue,
    defaultDataDir: stringValue,
    configFile: stringValue,
  }).strict(),
}).strict();

export type FoodOutput = z.infer<typeof FoodOutputSchema>;
export type CustomFoodSearchOutput = z.infer<typeof CustomFoodSearchOutputSchema>;
export type CustomFoodListItem = z.infer<typeof CustomFoodListItemSchema>;
export type MealOutput = z.infer<typeof MealOutputSchema>;
export type RecipeOutput = z.infer<typeof RecipeOutputSchema>;
export type RecipeSuggestionOutput = z.infer<typeof RecipeSuggestionSchema>;
