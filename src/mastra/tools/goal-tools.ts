import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { setUserGoals, getUserGoals } from "../../db";
import { nutritionGoalsSchema } from "../../db/nutrient-fields";

// Comprehensive guidance for setting nutrition goals
const GOAL_GUIDANCE = {
  calories: {
    description: "Daily calorie target",
    guidance: "Typical: 1500-2500. Weight loss: deficit of 500. Maintenance: TDEE calculator.",
  },
  protein: {
    description: "Daily protein target in grams",
    guidance: "RDA: 0.8g/kg body weight. Athletes: 1.6-2.2g/kg. High protein diet: 100-150g.",
  },
  carbs: {
    description: "Daily carbohydrate target in grams (total)",
    guidance: "Standard: 225-325g. Low-carb: <100g. Keto: use net_carbs instead.",
  },
  fat: {
    description: "Daily fat target in grams",
    guidance: "Typically 20-35% of calories. 65-90g for 2000 cal diet.",
  },
  fiber_g: {
    description: "Daily fiber target in grams",
    guidance: "RDA: Women 25g, Men 38g. Most people get only 15g.",
  },
  sugar_g: {
    description: "Daily added sugar maximum in grams",
    guidance: "RDA: <50g (10% of calories). AHA: Women <25g, Men <36g.",
  },
  sodium_mg: {
    description: "Daily sodium maximum in milligrams",
    guidance: "RDA: <2300mg. Heart health: <1500mg. Average American: 3400mg.",
  },
  net_carbs: {
    description: "Daily net carbs (carbs - fiber - sugar alcohols) for keto",
    guidance: "Strict keto: <20g. Moderate keto: <50g. Low-carb: <100g.",
  },
  saturated_fat_g: {
    description: "Daily saturated fat maximum in grams",
    guidance: "AHA: <13g for 2000 cal diet. <7% of total calories.",
  },
  cholesterol_mg: {
    description: "Daily cholesterol maximum in milligrams",
    guidance: "General: <300mg. Heart disease risk: <200mg.",
  },
  potassium_mg: {
    description: "Daily potassium target in milligrams",
    guidance: "RDA: 2600-3400mg. Most Americans get ~2500mg.",
  },
  calcium_mg: {
    description: "Daily calcium target in milligrams",
    guidance: "RDA: 1000-1200mg. Upper limit: 2500mg.",
  },
  iron_mg: {
    description: "Daily iron target in milligrams",
    guidance: "RDA: Men 8mg, Women 18mg (pre-menopause). Upper limit: 45mg.",
  },
  magnesium_mg: {
    description: "Daily magnesium target in milligrams",
    guidance: "RDA: Men 400-420mg, Women 310-320mg.",
  },
  vitamin_d_ug: {
    description: "Daily vitamin D target in micrograms",
    guidance: "RDA: 15-20ug (600-800 IU). Upper limit: 100ug.",
  },
  vitamin_c_mg: {
    description: "Daily vitamin C target in milligrams",
    guidance: "RDA: Men 90mg, Women 75mg. Upper limit: 2000mg.",
  },
  vitamin_b12_ug: {
    description: "Daily vitamin B12 target in micrograms",
    guidance: "RDA: 2.4ug. Vegetarians/vegans may need supplements.",
  },
};

// Goals output schema for responses
const goalsResponseSchema = z.object({
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
  potassium_mg: z.number().nullable(),
  calcium_mg: z.number().nullable(),
  iron_mg: z.number().nullable(),
  magnesium_mg: z.number().nullable(),
  vitamin_d_ug: z.number().nullable(),
  vitamin_c_mg: z.number().nullable(),
  vitamin_b12_ug: z.number().nullable(),
});

export const setGoals = createTool({
  id: "set_user_goals",
  description: `Set daily nutrition targets for a user. This will replace any existing goals.

GUIDANCE FOR USERS:
• Calories: ${GOAL_GUIDANCE.calories.guidance}
• Protein: ${GOAL_GUIDANCE.protein.guidance}
• Carbs: ${GOAL_GUIDANCE.carbs.guidance}
• Fat: ${GOAL_GUIDANCE.fat.guidance}
• Fiber: ${GOAL_GUIDANCE.fiber_g.guidance}
• Sugar (max): ${GOAL_GUIDANCE.sugar_g.guidance}
• Sodium (max): ${GOAL_GUIDANCE.sodium_mg.guidance}
• Net Carbs: ${GOAL_GUIDANCE.net_carbs.guidance}
• Saturated Fat (max): ${GOAL_GUIDANCE.saturated_fat_g.guidance}
• Cholesterol (max): ${GOAL_GUIDANCE.cholesterol_mg.guidance}`,
  inputSchema: z
    .object({
      userId: z.string().describe("The user ID"),
      calories: z.number().positive().describe(GOAL_GUIDANCE.calories.description),
      protein: z.number().positive().optional().describe(GOAL_GUIDANCE.protein.description),
      carbs: z.number().positive().optional().describe(GOAL_GUIDANCE.carbs.description),
      fat: z.number().positive().optional().describe(GOAL_GUIDANCE.fat.description),
      fiber_g: z.number().positive().optional().describe(GOAL_GUIDANCE.fiber_g.description),
      sugar_g: z.number().positive().optional().describe(GOAL_GUIDANCE.sugar_g.description),
      sodium_mg: z.number().positive().optional().describe(GOAL_GUIDANCE.sodium_mg.description),
      net_carbs: z.number().positive().optional().describe(GOAL_GUIDANCE.net_carbs.description),
      saturated_fat_g: z.number().positive().optional().describe(GOAL_GUIDANCE.saturated_fat_g.description),
      cholesterol_mg: z.number().positive().optional().describe(GOAL_GUIDANCE.cholesterol_mg.description),
      potassium_mg: z.number().positive().optional().describe(GOAL_GUIDANCE.potassium_mg.description),
      calcium_mg: z.number().positive().optional().describe(GOAL_GUIDANCE.calcium_mg.description),
      iron_mg: z.number().positive().optional().describe(GOAL_GUIDANCE.iron_mg.description),
      magnesium_mg: z.number().positive().optional().describe(GOAL_GUIDANCE.magnesium_mg.description),
      vitamin_d_ug: z.number().positive().optional().describe(GOAL_GUIDANCE.vitamin_d_ug.description),
      vitamin_c_mg: z.number().positive().optional().describe(GOAL_GUIDANCE.vitamin_c_mg.description),
      vitamin_b12_ug: z.number().positive().optional().describe(GOAL_GUIDANCE.vitamin_b12_ug.description),
    }),
  outputSchema: z.object({
    success: z.boolean(),
    goals: goalsResponseSchema,
    message: z.string(),
    guidance: z.string(),
  }),
  execute: async ({ context }) => {
    const now = new Date().toISOString();

    await setUserGoals({
      user_id: context.userId,
      calories: context.calories,
      protein: context.protein,
      carbs: context.carbs,
      fat: context.fat,
      fiber_g: context.fiber_g,
      sugar_g: context.sugar_g,
      sodium_mg: context.sodium_mg,
      net_carbs: context.net_carbs,
      saturated_fat_g: context.saturated_fat_g,
      cholesterol_mg: context.cholesterol_mg,
      potassium_mg: context.potassium_mg,
      calcium_mg: context.calcium_mg,
      iron_mg: context.iron_mg,
      magnesium_mg: context.magnesium_mg,
      vitamin_d_ug: context.vitamin_d_ug,
      vitamin_c_mg: context.vitamin_c_mg,
      vitamin_b12_ug: context.vitamin_b12_ug,
      updated_at: now,
    });

    // Build summary message
    const parts = [`${context.calories} cal`];
    if (context.protein) parts.push(`${context.protein}g protein`);
    if (context.carbs) parts.push(`${context.carbs}g carbs`);
    if (context.fat) parts.push(`${context.fat}g fat`);
    if (context.fiber_g) parts.push(`${context.fiber_g}g fiber`);
    if (context.sugar_g) parts.push(`<${context.sugar_g}g sugar`);
    if (context.sodium_mg) parts.push(`<${context.sodium_mg}mg sodium`);
    if (context.net_carbs) parts.push(`${context.net_carbs}g net carbs`);
    if (context.saturated_fat_g) parts.push(`<${context.saturated_fat_g}g sat fat`);
    if (context.cholesterol_mg) parts.push(`<${context.cholesterol_mg}mg cholesterol`);

    return {
      success: true,
      goals: {
        calories: context.calories,
        protein: context.protein ?? null,
        carbs: context.carbs ?? null,
        fat: context.fat ?? null,
        fiber_g: context.fiber_g ?? null,
        sugar_g: context.sugar_g ?? null,
        sodium_mg: context.sodium_mg ?? null,
        net_carbs: context.net_carbs ?? null,
        saturated_fat_g: context.saturated_fat_g ?? null,
        cholesterol_mg: context.cholesterol_mg ?? null,
        potassium_mg: context.potassium_mg ?? null,
        calcium_mg: context.calcium_mg ?? null,
        iron_mg: context.iron_mg ?? null,
        magnesium_mg: context.magnesium_mg ?? null,
        vitamin_d_ug: context.vitamin_d_ug ?? null,
        vitamin_c_mg: context.vitamin_c_mg ?? null,
        vitamin_b12_ug: context.vitamin_b12_ug ?? null,
      },
      message: `Daily targets set: ${parts.join(", ")}`,
      guidance: "Track your meals to see progress. Use search_food to find nutrition info before logging.",
    };
  },
});

export const getGoals = createTool({
  id: "get_user_goals",
  description: "Get the current daily nutrition targets for a user, with guidance on adjustments.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
  }),
  outputSchema: z.object({
    hasGoals: z.boolean(),
    goals: z
      .object({
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
        potassium_mg: z.number().nullable(),
        calcium_mg: z.number().nullable(),
        iron_mg: z.number().nullable(),
        magnesium_mg: z.number().nullable(),
        vitamin_d_ug: z.number().nullable(),
        vitamin_c_mg: z.number().nullable(),
        vitamin_b12_ug: z.number().nullable(),
        updatedAt: z.string(),
      })
      .nullable(),
    guidance: z.record(z.string(), z.string()).describe("Guidance for each nutrient"),
  }),
  execute: async ({ context }) => {
    const goals = await getUserGoals(context.userId);

    // Build guidance object
    const guidance: Record<string, string> = {};
    for (const [key, value] of Object.entries(GOAL_GUIDANCE)) {
      guidance[key] = value.guidance;
    }

    return {
      hasGoals: goals !== null,
      goals: goals
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
            potassium_mg: goals.potassium_mg ?? null,
            calcium_mg: goals.calcium_mg ?? null,
            iron_mg: goals.iron_mg ?? null,
            magnesium_mg: goals.magnesium_mg ?? null,
            vitamin_d_ug: goals.vitamin_d_ug ?? null,
            vitamin_c_mg: goals.vitamin_c_mg ?? null,
            vitamin_b12_ug: goals.vitamin_b12_ug ?? null,
            updatedAt: goals.updated_at,
          }
        : null,
      guidance,
    };
  },
});
