import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { setUserGoals, getUserGoals } from "../../db";

// Guidance for setting nutrition goals
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
    description: "Daily carbohydrate target in grams (total or net, your choice)",
    guidance: "Standard: 225-325g. Low-carb: <100g. Keto: <20-50g net carbs.",
  },
  fat: {
    description: "Daily fat target in grams",
    guidance: "Typically 20-35% of calories. 65-90g for 2000 cal diet.",
  },
  fiber: {
    description: "Daily fiber target in grams",
    guidance: "RDA: Women 25g, Men 38g. Most people get only 15g.",
  },
  sodium: {
    description: "Daily sodium maximum in milligrams",
    guidance: "RDA: <2300mg. Heart health: <1500mg. Average American: 3400mg.",
  },
  sugar: {
    description: "Daily added sugar maximum in grams",
    guidance: "RDA: <50g (10% of calories). AHA: Women <25g, Men <36g.",
  },
};

export const setGoals = createTool({
  id: "set_user_goals",
  description: `Set daily nutrition targets for a user. This will replace any existing goals.

GUIDANCE FOR USERS:
• Calories: ${GOAL_GUIDANCE.calories.guidance}
• Protein: ${GOAL_GUIDANCE.protein.guidance}
• Carbs: ${GOAL_GUIDANCE.carbs.guidance}
• Fat: ${GOAL_GUIDANCE.fat.guidance}
• Fiber: ${GOAL_GUIDANCE.fiber.guidance}
• Sodium: ${GOAL_GUIDANCE.sodium.guidance}
• Sugar: ${GOAL_GUIDANCE.sugar.guidance}`,
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    calories: z.number().positive().describe(GOAL_GUIDANCE.calories.description),
    protein: z.number().positive().optional().describe(GOAL_GUIDANCE.protein.description),
    carbs: z.number().positive().optional().describe(GOAL_GUIDANCE.carbs.description),
    fat: z.number().positive().optional().describe(GOAL_GUIDANCE.fat.description),
    fiber: z.number().positive().optional().describe(GOAL_GUIDANCE.fiber.description),
    sodium: z.number().positive().optional().describe(GOAL_GUIDANCE.sodium.description),
    sugar: z.number().positive().optional().describe(GOAL_GUIDANCE.sugar.description),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    goals: z.object({
      calories: z.number(),
      protein: z.number().nullable(),
      carbs: z.number().nullable(),
      fat: z.number().nullable(),
      fiber: z.number().nullable(),
      sodium: z.number().nullable(),
      sugar: z.number().nullable(),
    }),
    message: z.string(),
    guidance: z.string(),
  }),
  execute: async ({ context }) => {
    const now = new Date().toISOString();

    await setUserGoals({
      user_id: context.userId,
      calories: context.calories,
      protein: context.protein ?? null,
      carbs: context.carbs ?? null,
      fat: context.fat ?? null,
      fiber: context.fiber ?? null,
      sodium: context.sodium ?? null,
      sugar: context.sugar ?? null,
      updated_at: now,
    });

    const parts = [`${context.calories} cal`];
    if (context.protein) parts.push(`${context.protein}g protein`);
    if (context.carbs) parts.push(`${context.carbs}g carbs`);
    if (context.fat) parts.push(`${context.fat}g fat`);
    if (context.fiber) parts.push(`${context.fiber}g fiber`);
    if (context.sodium) parts.push(`${context.sodium}mg sodium max`);
    if (context.sugar) parts.push(`${context.sugar}g sugar max`);

    return {
      success: true,
      goals: {
        calories: context.calories,
        protein: context.protein ?? null,
        carbs: context.carbs ?? null,
        fat: context.fat ?? null,
        fiber: context.fiber ?? null,
        sodium: context.sodium ?? null,
        sugar: context.sugar ?? null,
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
        fiber: z.number().nullable(),
        sodium: z.number().nullable(),
        sugar: z.number().nullable(),
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
            calories: goals.calories,
            protein: goals.protein,
            carbs: goals.carbs,
            fat: goals.fat,
            fiber: goals.fiber ?? null,
            sodium: goals.sodium ?? null,
            sugar: goals.sugar ?? null,
            updatedAt: goals.updated_at,
          }
        : null,
      guidance,
    };
  },
});
