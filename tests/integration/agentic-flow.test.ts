import { beforeAll, afterAll, describe, test, expect, setDefaultTimeout } from "bun:test";

// Increase timeout for integration tests that involve embeddings
setDefaultTimeout(30000);
import { rm } from "node:fs/promises";
import { setDbPath, resetDb, addMealLog, getMealsByDate, setUserGoals, getUserGoals } from "../../src/db";
import type { MealLogInput } from "../../src/db/schemas";
import { DEFAULT_NUTRITION, type FullNutrition } from "../../src/db/nutrient-fields";

/**
 * Comprehensive integration tests for the full nutrition tracking system.
 *
 * Tests real-world scenarios:
 * - Full day of eating (fast food vs healthy)
 * - Goal tracking with all nutrients
 * - Deficit analysis
 * - Batch meal logging
 */
describe("Nutrition Tracking Integration Tests", () => {
  const TEST_DB_PATH = "./data/lance-int";

  beforeAll(async () => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for integration tests.");
    }
    await rm(TEST_DB_PATH, { recursive: true, force: true });
    setDbPath(TEST_DB_PATH);
  });

  afterAll(async () => {
    await resetDb();
    await rm(TEST_DB_PATH, { recursive: true, force: true });
  });

  /**
   * Helper to create a meal with full nutrition
   */
  function createMeal(
    userId: string,
    foodName: string,
    mealType: "breakfast" | "lunch" | "dinner" | "snack",
    nutrition: Partial<FullNutrition>,
    opts?: { quantity?: number; unit?: string; notes?: string }
  ): MealLogInput {
    return {
      id: crypto.randomUUID(),
      user_id: userId,
      food_id: null,
      food_name: foodName,
      quantity: opts?.quantity ?? 1,
      unit: opts?.unit ?? "serving",
      meal_type: mealType,
      logged_at: new Date().toISOString(),
      notes: opts?.notes ?? null,
      ...DEFAULT_NUTRITION,
      ...nutrition,
    };
  }

  describe("Fast Food Day Scenario", () => {
    const userId = `fastfood-user-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0]!;

    test("logs a typical fast food day and analyzes nutrition", async () => {
      // Set realistic goals for an adult
      await setUserGoals({
        user_id: userId,
        calories: 2000,
        protein: 150,
        carbs: 225,
        fat: 65,
        fiber_g: 30,
        sugar_g: 50, // Max
        sodium_mg: 2300, // Max
        saturated_fat_g: 20, // Max
        cholesterol_mg: 300, // Max
        updated_at: new Date().toISOString(),
      });

      // Typical fast food day meals with realistic nutrition data
      const fastFoodMeals = [
        // Breakfast: Egg McMuffin + hash brown + coffee
        createMeal(userId, "Egg McMuffin", "breakfast", {
          calories: 300,
          protein: 17,
          carbs: 30,
          fat: 13,
          fiber_g: 2,
          sugar_g: 3,
          sodium_mg: 820,
          saturated_fat_g: 6,
          cholesterol_mg: 260,
        }),
        createMeal(userId, "Hash Brown", "breakfast", {
          calories: 140,
          protein: 1,
          carbs: 15,
          fat: 9,
          fiber_g: 1,
          sugar_g: 0,
          sodium_mg: 310,
          saturated_fat_g: 1.5,
          cholesterol_mg: 0,
        }),
        createMeal(userId, "Medium Coffee with cream", "breakfast", {
          calories: 50,
          protein: 0,
          carbs: 2,
          fat: 4,
          fiber_g: 0,
          sugar_g: 1,
          sodium_mg: 10,
          saturated_fat_g: 2.5,
          cholesterol_mg: 15,
        }),

        // Lunch: Big Mac meal
        createMeal(userId, "Big Mac", "lunch", {
          calories: 550,
          protein: 25,
          carbs: 45,
          fat: 30,
          fiber_g: 3,
          sugar_g: 9,
          sodium_mg: 1010,
          saturated_fat_g: 11,
          cholesterol_mg: 80,
        }),
        createMeal(userId, "Medium Fries", "lunch", {
          calories: 320,
          protein: 5,
          carbs: 43,
          fat: 15,
          fiber_g: 4,
          sugar_g: 0,
          sodium_mg: 260,
          saturated_fat_g: 2,
          cholesterol_mg: 0,
        }),
        createMeal(userId, "Medium Coca-Cola", "lunch", {
          calories: 210,
          protein: 0,
          carbs: 58,
          fat: 0,
          fiber_g: 0,
          sugar_g: 58,
          sodium_mg: 30,
          saturated_fat_g: 0,
          cholesterol_mg: 0,
        }),

        // Dinner: Wendy's Baconator meal
        createMeal(userId, "Baconator", "dinner", {
          calories: 950,
          protein: 57,
          carbs: 41,
          fat: 62,
          fiber_g: 2,
          sugar_g: 9,
          sodium_mg: 1750,
          saturated_fat_g: 27,
          cholesterol_mg: 200,
        }),
        createMeal(userId, "Large Fries", "dinner", {
          calories: 470,
          protein: 6,
          carbs: 63,
          fat: 22,
          fiber_g: 6,
          sugar_g: 0,
          sodium_mg: 470,
          saturated_fat_g: 4,
          cholesterol_mg: 0,
        }),

        // Snack: Chick-fil-A milkshake
        createMeal(userId, "Chocolate Milkshake", "snack", {
          calories: 580,
          protein: 14,
          carbs: 85,
          fat: 22,
          fiber_g: 1,
          sugar_g: 77,
          sodium_mg: 420,
          saturated_fat_g: 13,
          cholesterol_mg: 80,
        }),
      ];

      // Log all meals
      for (const meal of fastFoodMeals) {
        await addMealLog(meal);
      }

      // Get the day's meals and calculate totals
      const meals = await getMealsByDate(userId, today);
      expect(meals.length).toBe(9);

      // Calculate totals
      const totals = {
        calories: meals.reduce((sum, m) => sum + m.calories, 0),
        protein: meals.reduce((sum, m) => sum + m.protein, 0),
        carbs: meals.reduce((sum, m) => sum + m.carbs, 0),
        fat: meals.reduce((sum, m) => sum + m.fat, 0),
        fiber_g: meals.reduce((sum, m) => sum + (m.fiber_g ?? 0), 0),
        sugar_g: meals.reduce((sum, m) => sum + (m.sugar_g ?? 0), 0),
        sodium_mg: meals.reduce((sum, m) => sum + (m.sodium_mg ?? 0), 0),
        saturated_fat_g: meals.reduce((sum, m) => sum + (m.saturated_fat_g ?? 0), 0),
        cholesterol_mg: meals.reduce((sum, m) => sum + (m.cholesterol_mg ?? 0), 0),
      };

      // Verify totals match expectations
      expect(totals.calories).toBe(3570); // Way over 2000 cal goal
      expect(totals.protein).toBe(125); // Under 150g goal
      expect(totals.sugar_g).toBe(157); // 3x over 50g max!
      expect(totals.sodium_mg).toBe(5080); // 2x+ over 2300mg max!
      expect(totals.saturated_fat_g).toBe(67); // 3x+ over 20g max!
      expect(totals.cholesterol_mg).toBe(635); // 2x over 300mg max!

      // Get goals and calculate deficits/excesses
      const goals = await getUserGoals(userId);
      expect(goals).not.toBeNull();

      const analysis = {
        caloriesOver: totals.calories - (goals?.calories ?? 0),
        proteinDeficit: (goals?.protein ?? 0) - totals.protein,
        fiberDeficit: (goals?.fiber_g ?? 0) - totals.fiber_g,
        sodiumOver: totals.sodium_mg - (goals?.sodium_mg ?? 0),
        sugarOver: totals.sugar_g - (goals?.sugar_g ?? 0),
        satFatOver: totals.saturated_fat_g - (goals?.saturated_fat_g ?? 0),
      };

      console.log("\n=== FAST FOOD DAY ANALYSIS ===");
      console.log(`Calories: ${totals.calories} / ${goals?.calories} (${analysis.caloriesOver > 0 ? "+" : ""}${analysis.caloriesOver})`);
      console.log(`Protein: ${totals.protein}g / ${goals?.protein}g (deficit: ${analysis.proteinDeficit}g)`);
      console.log(`Fiber: ${totals.fiber_g}g / ${goals?.fiber_g}g (deficit: ${analysis.fiberDeficit}g)`);
      console.log(`Sugar: ${totals.sugar_g}g / ${goals?.sugar_g}g max (${analysis.sugarOver > 0 ? "+" : ""}${analysis.sugarOver}g OVER)`);
      console.log(`Sodium: ${totals.sodium_mg}mg / ${goals?.sodium_mg}mg max (${analysis.sodiumOver > 0 ? "+" : ""}${analysis.sodiumOver}mg OVER)`);
      console.log(`Sat Fat: ${totals.saturated_fat_g}g / ${goals?.saturated_fat_g}g max (${analysis.satFatOver > 0 ? "+" : ""}${analysis.satFatOver}g OVER)`);

      // The fast food day exceeds multiple maximum limits
      expect(analysis.caloriesOver).toBeGreaterThan(1500);
      expect(analysis.sodiumOver).toBeGreaterThan(2000);
      expect(analysis.sugarOver).toBeGreaterThan(100);
    });
  });

  describe("Healthy Day Scenario", () => {
    const userId = `healthy-user-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0]!;

    test("logs a healthy day and shows better nutrient profile", async () => {
      // Same goals as fast food test
      await setUserGoals({
        user_id: userId,
        calories: 2000,
        protein: 150,
        carbs: 225,
        fat: 65,
        fiber_g: 30,
        sugar_g: 50,
        sodium_mg: 2300,
        saturated_fat_g: 20,
        cholesterol_mg: 300,
        potassium_mg: 3500,
        vitamin_d_ug: 15,
        calcium_mg: 1000,
        iron_mg: 18,
        updated_at: new Date().toISOString(),
      });

      // Healthy day meals
      const healthyMeals = [
        // Breakfast: Oatmeal with berries and eggs
        createMeal(userId, "Steel cut oatmeal with blueberries", "breakfast", {
          calories: 300,
          protein: 10,
          carbs: 55,
          fat: 6,
          fiber_g: 8,
          sugar_g: 12,
          sodium_mg: 5,
          saturated_fat_g: 1,
          cholesterol_mg: 0,
          potassium_mg: 290,
          iron_mg: 2.5,
        }),
        createMeal(userId, "Two scrambled eggs", "breakfast", {
          calories: 180,
          protein: 12,
          carbs: 2,
          fat: 14,
          fiber_g: 0,
          sugar_g: 1,
          sodium_mg: 190,
          saturated_fat_g: 4,
          cholesterol_mg: 370,
          vitamin_d_ug: 2,
          iron_mg: 1.8,
        }),
        createMeal(userId, "Black coffee", "breakfast", {
          calories: 5,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber_g: 0,
          sugar_g: 0,
          sodium_mg: 5,
          saturated_fat_g: 0,
          cholesterol_mg: 0,
          potassium_mg: 120,
        }),

        // Lunch: Grilled chicken salad
        createMeal(userId, "Grilled chicken breast (6oz)", "lunch", {
          calories: 280,
          protein: 52,
          carbs: 0,
          fat: 6,
          fiber_g: 0,
          sugar_g: 0,
          sodium_mg: 120,
          saturated_fat_g: 1.5,
          cholesterol_mg: 130,
          iron_mg: 1.2,
          vitamin_b12_ug: 0.6,
        }),
        createMeal(userId, "Mixed greens salad with olive oil dressing", "lunch", {
          calories: 180,
          protein: 3,
          carbs: 12,
          fat: 14,
          fiber_g: 4,
          sugar_g: 3,
          sodium_mg: 180,
          saturated_fat_g: 2,
          cholesterol_mg: 0,
          potassium_mg: 420,
          vitamin_a_ug: 350,
          vitamin_c_mg: 25,
        }),
        createMeal(userId, "Quinoa (1 cup cooked)", "lunch", {
          calories: 220,
          protein: 8,
          carbs: 40,
          fat: 3.5,
          fiber_g: 5,
          sugar_g: 2,
          sodium_mg: 13,
          saturated_fat_g: 0.4,
          cholesterol_mg: 0,
          iron_mg: 2.8,
          magnesium_mg: 118,
        }),

        // Snack: Greek yogurt and almonds
        createMeal(userId, "Plain Greek yogurt (1 cup)", "snack", {
          calories: 130,
          protein: 23,
          carbs: 8,
          fat: 0,
          fiber_g: 0,
          sugar_g: 7,
          sodium_mg: 65,
          saturated_fat_g: 0,
          cholesterol_mg: 10,
          calcium_mg: 280,
          vitamin_d_ug: 1,
        }),
        createMeal(userId, "Almonds (1oz)", "snack", {
          calories: 160,
          protein: 6,
          carbs: 6,
          fat: 14,
          fiber_g: 3.5,
          sugar_g: 1,
          sodium_mg: 0,
          saturated_fat_g: 1,
          cholesterol_mg: 0,
          magnesium_mg: 75,
          vitamin_e_mg: 7.3,
        }),

        // Dinner: Salmon with vegetables
        createMeal(userId, "Baked salmon (6oz)", "dinner", {
          calories: 350,
          protein: 40,
          carbs: 0,
          fat: 20,
          fiber_g: 0,
          sugar_g: 0,
          sodium_mg: 90,
          saturated_fat_g: 4,
          cholesterol_mg: 95,
          omega_3_g: 3.5,
          vitamin_d_ug: 14,
          vitamin_b12_ug: 4.8,
        }),
        createMeal(userId, "Roasted broccoli and sweet potato", "dinner", {
          calories: 200,
          protein: 5,
          carbs: 40,
          fat: 4,
          fiber_g: 8,
          sugar_g: 12,
          sodium_mg: 120,
          saturated_fat_g: 0.5,
          cholesterol_mg: 0,
          potassium_mg: 800,
          vitamin_a_ug: 1100,
          vitamin_c_mg: 60,
          calcium_mg: 80,
        }),
      ];

      // Log all meals
      for (const meal of healthyMeals) {
        await addMealLog(meal);
      }

      // Get and analyze the day
      const meals = await getMealsByDate(userId, today);
      expect(meals.length).toBe(10);

      const totals = {
        calories: meals.reduce((sum, m) => sum + m.calories, 0),
        protein: meals.reduce((sum, m) => sum + m.protein, 0),
        carbs: meals.reduce((sum, m) => sum + m.carbs, 0),
        fat: meals.reduce((sum, m) => sum + m.fat, 0),
        fiber_g: meals.reduce((sum, m) => sum + (m.fiber_g ?? 0), 0),
        sugar_g: meals.reduce((sum, m) => sum + (m.sugar_g ?? 0), 0),
        sodium_mg: meals.reduce((sum, m) => sum + (m.sodium_mg ?? 0), 0),
        saturated_fat_g: meals.reduce((sum, m) => sum + (m.saturated_fat_g ?? 0), 0),
        cholesterol_mg: meals.reduce((sum, m) => sum + (m.cholesterol_mg ?? 0), 0),
        potassium_mg: meals.reduce((sum, m) => sum + (m.potassium_mg ?? 0), 0),
        vitamin_d_ug: meals.reduce((sum, m) => sum + (m.vitamin_d_ug ?? 0), 0),
      };

      // Get goals
      const goals = await getUserGoals(userId);

      console.log("\n=== HEALTHY DAY ANALYSIS ===");
      console.log(`Calories: ${totals.calories} / ${goals?.calories}`);
      console.log(`Protein: ${totals.protein}g / ${goals?.protein}g`);
      console.log(`Fiber: ${totals.fiber_g}g / ${goals?.fiber_g}g`);
      console.log(`Sugar: ${totals.sugar_g}g / ${goals?.sugar_g}g max`);
      console.log(`Sodium: ${totals.sodium_mg}mg / ${goals?.sodium_mg}mg max`);
      console.log(`Sat Fat: ${totals.saturated_fat_g}g / ${goals?.saturated_fat_g}g max`);
      console.log(`Potassium: ${totals.potassium_mg}mg / ${goals?.potassium_mg}mg`);
      console.log(`Vitamin D: ${totals.vitamin_d_ug}ug / ${goals?.vitamin_d_ug}ug`);

      // Healthy day should be within or under limits
      expect(totals.calories).toBeLessThanOrEqual(2100); // Close to goal
      expect(totals.protein).toBeGreaterThan(140); // High protein
      expect(totals.fiber_g).toBeGreaterThan(25); // Good fiber
      expect(totals.sodium_mg).toBeLessThan(1000); // Low sodium
      expect(totals.saturated_fat_g).toBeLessThan(16); // Under sat fat limit
      expect(totals.sugar_g).toBeLessThan(50); // Under sugar limit
    });
  });

  describe("Deficit Analysis", () => {
    const userId = `deficit-user-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0]!;

    test("calculates what to eat to fill nutrient gaps", async () => {
      // Set goals
      await setUserGoals({
        user_id: userId,
        calories: 2000,
        protein: 150,
        carbs: 225,
        fat: 65,
        fiber_g: 30,
        calcium_mg: 1000,
        iron_mg: 18,
        vitamin_d_ug: 15,
        updated_at: new Date().toISOString(),
      });

      // Light eating day - partial meals
      const partialMeals = [
        createMeal(userId, "Banana", "breakfast", {
          calories: 105,
          protein: 1.3,
          carbs: 27,
          fat: 0.4,
          fiber_g: 3,
          sugar_g: 14,
          potassium_mg: 422,
        }),
        createMeal(userId, "Turkey sandwich", "lunch", {
          calories: 320,
          protein: 22,
          carbs: 35,
          fat: 10,
          fiber_g: 4,
          sugar_g: 4,
          sodium_mg: 680,
          cholesterol_mg: 45,
        }),
      ];

      for (const meal of partialMeals) {
        await addMealLog(meal);
      }

      const meals = await getMealsByDate(userId, today);
      const goals = await getUserGoals(userId);

      const eaten = {
        calories: meals.reduce((sum, m) => sum + m.calories, 0),
        protein: meals.reduce((sum, m) => sum + m.protein, 0),
        carbs: meals.reduce((sum, m) => sum + m.carbs, 0),
        fat: meals.reduce((sum, m) => sum + m.fat, 0),
        fiber_g: meals.reduce((sum, m) => sum + (m.fiber_g ?? 0), 0),
      };

      // Calculate what's needed to hit goals
      const needed = {
        calories: (goals?.calories ?? 0) - eaten.calories,
        protein: (goals?.protein ?? 0) - eaten.protein,
        carbs: (goals?.carbs ?? 0) - eaten.carbs,
        fat: (goals?.fat ?? 0) - eaten.fat,
        fiber_g: (goals?.fiber_g ?? 0) - eaten.fiber_g,
      };

      console.log("\n=== DEFICIT ANALYSIS ===");
      console.log(`Already eaten: ${eaten.calories} cal, ${eaten.protein}g protein, ${eaten.fiber_g}g fiber`);
      console.log(`Still need: ${needed.calories} cal, ${needed.protein}g protein, ${needed.fiber_g}g fiber`);

      // Suggest foods to fill gaps (high protein, high fiber options)
      const suggestions = [
        { name: "Grilled chicken breast (8oz)", protein: 53, fiber: 0, calories: 280 },
        { name: "Lentil soup (2 cups)", protein: 18, fiber: 16, calories: 460 },
        { name: "Greek yogurt with chia seeds", protein: 20, fiber: 10, calories: 200 },
        { name: "Salmon with broccoli", protein: 45, fiber: 5, calories: 400 },
      ];

      console.log("\nSuggested foods to fill your goals:");
      for (const food of suggestions) {
        const proteinPercent = Math.round((food.protein / needed.protein) * 100);
        const fiberPercent = Math.round((food.fiber / needed.fiber_g) * 100);
        console.log(`  ${food.name}: ${food.protein}g protein (${proteinPercent}%), ${food.fiber}g fiber (${fiberPercent}%)`);
      }

      // Verify the math
      expect(needed.calories).toBeGreaterThan(1500);
      expect(needed.protein).toBeGreaterThan(100);
      expect(needed.fiber_g).toBeGreaterThan(20);
    });
  });

  describe("Batch Meal Logging", () => {
    const userId = `batch-user-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0]!;

    test("handles logging 20+ meals efficiently", async () => {
      // Set goals first
      await setUserGoals({
        user_id: userId,
        calories: 2500,
        protein: 180,
        updated_at: new Date().toISOString(),
      });

      // Generate 20 varied meals
      const manyMeals: MealLogInput[] = [];
      const mealTypes: Array<"breakfast" | "lunch" | "dinner" | "snack"> = ["breakfast", "lunch", "dinner", "snack"];
      const foods = [
        { name: "Oatmeal", cal: 150, pro: 5, carb: 27, fat: 3 },
        { name: "Eggs", cal: 180, pro: 12, carb: 2, fat: 14 },
        { name: "Chicken breast", cal: 280, pro: 52, carb: 0, fat: 6 },
        { name: "Rice", cal: 200, pro: 4, carb: 44, fat: 0.5 },
        { name: "Broccoli", cal: 50, pro: 4, carb: 10, fat: 0.5 },
        { name: "Protein shake", cal: 160, pro: 30, carb: 5, fat: 2 },
        { name: "Greek yogurt", cal: 130, pro: 23, carb: 8, fat: 0 },
        { name: "Almonds", cal: 160, pro: 6, carb: 6, fat: 14 },
        { name: "Salmon", cal: 350, pro: 40, carb: 0, fat: 20 },
        { name: "Pasta", cal: 220, pro: 8, carb: 43, fat: 1 },
      ];

      const startTime = Date.now();

      for (let i = 0; i < 20; i++) {
        const food = foods[i % foods.length]!;
        const meal = createMeal(
          userId,
          `${food.name} #${i + 1}`,
          mealTypes[i % mealTypes.length]!,
          {
            calories: food.cal,
            protein: food.pro,
            carbs: food.carb,
            fat: food.fat,
            fiber_g: Math.round(Math.random() * 5),
            sodium_mg: Math.round(Math.random() * 500),
          }
        );
        manyMeals.push(meal);
      }

      // Log all meals
      for (const meal of manyMeals) {
        await addMealLog(meal);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`\n=== BATCH LOGGING PERFORMANCE ===`);
      console.log(`Logged 20 meals in ${duration}ms (${(duration / 20).toFixed(1)}ms per meal)`);

      // Verify all meals were logged
      const meals = await getMealsByDate(userId, today);
      expect(meals.length).toBe(20);

      // Verify totals
      const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
      const totalProtein = meals.reduce((sum, m) => sum + m.protein, 0);

      console.log(`Total calories: ${totalCalories}`);
      console.log(`Total protein: ${totalProtein}g`);

      expect(totalCalories).toBeGreaterThan(3000);
      expect(totalProtein).toBeGreaterThan(250);
    });
  });

  describe("Micronutrient Tracking", () => {
    const userId = `micro-user-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0]!;

    test("tracks vitamins and minerals across meals", async () => {
      // Set comprehensive micronutrient goals
      await setUserGoals({
        user_id: userId,
        calories: 2000,
        protein: 150,
        vitamin_d_ug: 15,
        vitamin_c_mg: 90,
        calcium_mg: 1000,
        iron_mg: 18,
        magnesium_mg: 400,
        potassium_mg: 3500,
        vitamin_b12_ug: 2.4,
        updated_at: new Date().toISOString(),
      });

      // Meals targeting specific micronutrients
      const microMeals = [
        // High vitamin D: fatty fish
        createMeal(userId, "Salmon (6oz)", "lunch", {
          calories: 350,
          protein: 40,
          carbs: 0,
          fat: 20,
          vitamin_d_ug: 14.2,
          vitamin_b12_ug: 4.8,
          omega_3_g: 3.5,
        }),
        // High vitamin C: citrus and peppers
        createMeal(userId, "Orange and bell pepper salad", "snack", {
          calories: 120,
          protein: 2,
          carbs: 28,
          fat: 0.5,
          vitamin_c_mg: 150,
          potassium_mg: 350,
          fiber_g: 5,
        }),
        // High calcium: dairy and greens
        createMeal(userId, "Greek yogurt with kale smoothie", "breakfast", {
          calories: 200,
          protein: 18,
          carbs: 22,
          fat: 4,
          calcium_mg: 450,
          vitamin_d_ug: 2,
          magnesium_mg: 60,
        }),
        // High iron: red meat and spinach
        createMeal(userId, "Steak with spinach", "dinner", {
          calories: 450,
          protein: 45,
          carbs: 8,
          fat: 25,
          iron_mg: 6.5,
          vitamin_b12_ug: 5.2,
          potassium_mg: 680,
          magnesium_mg: 80,
        }),
        // High potassium: bananas and potatoes
        createMeal(userId, "Baked potato with banana", "snack", {
          calories: 280,
          protein: 6,
          carbs: 65,
          fat: 0.5,
          potassium_mg: 1400,
          vitamin_c_mg: 35,
          magnesium_mg: 75,
          fiber_g: 7,
        }),
      ];

      for (const meal of microMeals) {
        await addMealLog(meal);
      }

      const meals = await getMealsByDate(userId, today);
      const goals = await getUserGoals(userId);

      // Calculate micronutrient totals
      const microTotals = {
        vitamin_d_ug: meals.reduce((sum, m) => sum + (m.vitamin_d_ug ?? 0), 0),
        vitamin_c_mg: meals.reduce((sum, m) => sum + (m.vitamin_c_mg ?? 0), 0),
        calcium_mg: meals.reduce((sum, m) => sum + (m.calcium_mg ?? 0), 0),
        iron_mg: meals.reduce((sum, m) => sum + (m.iron_mg ?? 0), 0),
        magnesium_mg: meals.reduce((sum, m) => sum + (m.magnesium_mg ?? 0), 0),
        potassium_mg: meals.reduce((sum, m) => sum + (m.potassium_mg ?? 0), 0),
        vitamin_b12_ug: meals.reduce((sum, m) => sum + (m.vitamin_b12_ug ?? 0), 0),
      };

      console.log("\n=== MICRONUTRIENT TRACKING ===");
      console.log(`Vitamin D: ${microTotals.vitamin_d_ug.toFixed(1)}ug / ${goals?.vitamin_d_ug}ug (${Math.round((microTotals.vitamin_d_ug / (goals?.vitamin_d_ug ?? 1)) * 100)}%)`);
      console.log(`Vitamin C: ${microTotals.vitamin_c_mg.toFixed(0)}mg / ${goals?.vitamin_c_mg}mg (${Math.round((microTotals.vitamin_c_mg / (goals?.vitamin_c_mg ?? 1)) * 100)}%)`);
      console.log(`Calcium: ${microTotals.calcium_mg.toFixed(0)}mg / ${goals?.calcium_mg}mg (${Math.round((microTotals.calcium_mg / (goals?.calcium_mg ?? 1)) * 100)}%)`);
      console.log(`Iron: ${microTotals.iron_mg.toFixed(1)}mg / ${goals?.iron_mg}mg (${Math.round((microTotals.iron_mg / (goals?.iron_mg ?? 1)) * 100)}%)`);
      console.log(`Magnesium: ${microTotals.magnesium_mg.toFixed(0)}mg / ${goals?.magnesium_mg}mg (${Math.round((microTotals.magnesium_mg / (goals?.magnesium_mg ?? 1)) * 100)}%)`);
      console.log(`Potassium: ${microTotals.potassium_mg.toFixed(0)}mg / ${goals?.potassium_mg}mg (${Math.round((microTotals.potassium_mg / (goals?.potassium_mg ?? 1)) * 100)}%)`);
      console.log(`B12: ${microTotals.vitamin_b12_ug.toFixed(1)}ug / ${goals?.vitamin_b12_ug}ug (${Math.round((microTotals.vitamin_b12_ug / (goals?.vitamin_b12_ug ?? 1)) * 100)}%)`);

      // Verify we're tracking vitamins and minerals
      expect(microTotals.vitamin_d_ug).toBeGreaterThan(15); // Met vitamin D goal
      expect(microTotals.vitamin_c_mg).toBeGreaterThan(150); // Well over vitamin C goal
      expect(microTotals.vitamin_b12_ug).toBeGreaterThan(8); // Way over B12 goal
      expect(microTotals.potassium_mg).toBeGreaterThan(2000); // Getting there on potassium
    });
  });
});
