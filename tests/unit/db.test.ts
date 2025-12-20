import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import {
  setDbPath,
  resetDb,
  getDb,
  getFoodsTable,
  getMealLogsTable,
  getAuditLogsTable,
  getUserGoalsTable,
  addFood,
  searchFoods,
  getFoodByBarcode,
  addMealLog,
  getMealsByDate,
  getMealHistory,
  searchMealLogs,
  setUserGoals,
  getUserGoals,
  addAuditLog,
  searchAuditLogs,
} from "../../src/db";
import { DEFAULT_NUTRITION } from "../../src/db/nutrient-fields";

const TEST_DB_PATH = "./data/lance-test";

describe("Database Operations", () => {
  beforeAll(async () => {
    // Clean up any existing test database
    try {
      await rm(TEST_DB_PATH, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
    // Set test database path
    setDbPath(TEST_DB_PATH);
  });

  afterAll(async () => {
    // Reset and clean up
    await resetDb();
    try {
      await rm(TEST_DB_PATH, { recursive: true, force: true });
    } catch {
      // Cleanup failed, not critical
    }
  });

  describe("Database Connection", () => {
    test("should connect to database", async () => {
      const db = await getDb();
      expect(db).toBeDefined();
    });

    test("should create tables lazily", async () => {
      const foodsTable = await getFoodsTable();
      expect(foodsTable).toBeDefined();

      const mealsTable = await getMealLogsTable();
      expect(mealsTable).toBeDefined();

      const auditTable = await getAuditLogsTable();
      expect(auditTable).toBeDefined();

      const goalsTable = await getUserGoalsTable();
      expect(goalsTable).toBeDefined();
    });
  });

  describe("User Goals (no embeddings required)", () => {
    const testUserId = "test-user-goals";

    test("should return null for non-existent user goals", async () => {
      const goals = await getUserGoals("non-existent-user");
      expect(goals).toBeNull();
    });

    test("should set and get user goals with full nutrition fields", async () => {
      const goalsInput = {
        user_id: testUserId,
        calories: 2000,
        protein: 150,
        carbs: 200,
        fat: 70,
        fiber_g: 30,
        sodium_mg: 2300,
        sugar_g: 50,
        net_carbs: 100,
        saturated_fat_g: 20,
        cholesterol_mg: 300,
        potassium_mg: 3500,
        calcium_mg: 1000,
        iron_mg: 18,
        magnesium_mg: 400,
        vitamin_d_ug: 15,
        vitamin_c_mg: 90,
        vitamin_b12_ug: 2.4,
        updated_at: new Date().toISOString(),
      };

      await setUserGoals(goalsInput);
      const retrieved = await getUserGoals(testUserId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.user_id).toBe(testUserId);
      expect(retrieved!.calories).toBe(2000);
      expect(retrieved!.protein).toBe(150);
      expect(retrieved!.carbs).toBe(200);
      expect(retrieved!.fat).toBe(70);
      expect(retrieved!.fiber_g).toBe(30);
      expect(retrieved!.sodium_mg).toBe(2300);
      expect(retrieved!.sugar_g).toBe(50);
      expect(retrieved!.net_carbs).toBe(100);
      expect(retrieved!.saturated_fat_g).toBe(20);
      expect(retrieved!.cholesterol_mg).toBe(300);
    });

    test("should update existing user goals", async () => {
      const updatedGoals = {
        user_id: testUserId,
        calories: 2500,
        protein: 180,
        fiber_g: 35,
        updated_at: new Date().toISOString(),
      };

      await setUserGoals(updatedGoals);
      const retrieved = await getUserGoals(testUserId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.calories).toBe(2500);
      expect(retrieved!.protein).toBe(180);
      expect(retrieved!.fiber_g).toBe(35);
      // Previous values should be cleared on update
      expect(retrieved!.carbs).toBeUndefined();
      expect(retrieved!.sodium_mg).toBeUndefined();
    });
  });
});

describe("Database Operations with Embeddings", () => {
  // These tests require OPENAI_API_KEY to be set
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    setDbPath(TEST_DB_PATH);
  });

  describe.skipIf(!hasOpenAIKey)("Food Operations", () => {
    const testFoodId = "test-food-" + Date.now();

    test("should add a food item with full nutrition", async () => {
      const food = {
        id: testFoodId,
        name: "Grilled Chicken Breast",
        brand: "Generic",
        barcode: "123456789012",
        serving_size: "100g",
        serving_grams: 100,
        source: "custom" as const,
        // Core macros
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        // Extended nutrition
        fiber_g: 0,
        sugar_g: 0,
        sugar_alcohols_g: null,
        net_carbs: 0,
        cholesterol_mg: 85,
        saturated_fat_g: 1,
        trans_fat_g: 0,
        monounsaturated_fat_g: 1.2,
        polyunsaturated_fat_g: 0.8,
        omega_3_g: null,
        omega_6_g: null,
        // Vitamins
        vitamin_a_ug: null,
        vitamin_c_mg: 0,
        vitamin_d_ug: null,
        vitamin_e_mg: null,
        vitamin_k_ug: null,
        thiamin_mg: null,
        riboflavin_mg: null,
        niacin_mg: 13.4,
        vitamin_b6_mg: 0.6,
        vitamin_b12_ug: 0.3,
        folate_ug: null,
        choline_mg: null,
        // Minerals
        calcium_mg: 15,
        iron_mg: 1,
        magnesium_mg: 29,
        phosphorus_mg: 228,
        potassium_mg: 256,
        sodium_mg: 74,
        zinc_mg: 1,
        copper_mg: null,
        manganese_mg: null,
        selenium_ug: 27.6,
      };

      await addFood(food);
      // If no error thrown, food was added successfully
      expect(true).toBe(true);
    });

    test("should search for foods semantically", async () => {
      // Wait a moment for the food to be indexed
      await new Promise((resolve) => setTimeout(resolve, 100));

      const results = await searchFoods("chicken", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name.toLowerCase()).toContain("chicken");
    });

    test("should find food by barcode", async () => {
      const food = await getFoodByBarcode("123456789012");
      expect(food).not.toBeNull();
      expect(food!.name).toBe("Grilled Chicken Breast");
    });

    test("should return null for non-existent barcode", async () => {
      const food = await getFoodByBarcode("000000000000");
      expect(food).toBeNull();
    });
  });

  describe.skipIf(!hasOpenAIKey)("Meal Log Operations", () => {
    const testUserId = "test-user-meals";
    const today = new Date().toISOString().split("T")[0];

    test("should add a meal log with full nutrition", async () => {
      const meal = {
        id: "test-meal-" + Date.now(),
        user_id: testUserId,
        food_id: null,
        food_name: "Oatmeal with Berries",
        quantity: 1,
        unit: "bowl",
        meal_type: "breakfast" as const,
        logged_at: new Date().toISOString(),
        notes: "Added honey",
        // Core macros
        calories: 350,
        protein: 12,
        carbs: 60,
        fat: 8,
        // Extended nutrition
        fiber_g: 8,
        sugar_g: 15,
        sugar_alcohols_g: null,
        net_carbs: 52,
        cholesterol_mg: 0,
        saturated_fat_g: 1.5,
        trans_fat_g: 0,
        monounsaturated_fat_g: null,
        polyunsaturated_fat_g: null,
        omega_3_g: null,
        omega_6_g: null,
        // Vitamins
        vitamin_a_ug: null,
        vitamin_c_mg: 4,
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
        calcium_mg: 20,
        iron_mg: 4,
        magnesium_mg: 60,
        phosphorus_mg: null,
        potassium_mg: 200,
        sodium_mg: 5,
        zinc_mg: null,
        copper_mg: null,
        manganese_mg: null,
        selenium_ug: null,
      };

      await addMealLog(meal);
      expect(true).toBe(true);
    });

    test("should get meals by date", async () => {
      const meals = await getMealsByDate(testUserId, today!);
      expect(meals.length).toBeGreaterThan(0);
      expect(meals[0]!.user_id).toBe(testUserId);
    });

    test("should get meal history", async () => {
      const history = await getMealHistory(testUserId, undefined, undefined, 10);
      expect(history.length).toBeGreaterThan(0);
    });

    test("should search meals semantically", async () => {
      const results = await searchMealLogs(testUserId, "oatmeal breakfast", 5);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!hasOpenAIKey)("Audit Log Operations", () => {
    const testUserId = "test-user-audit";
    const testSessionId = "test-session-" + Date.now();

    test("should add an audit log", async () => {
      const log = {
        id: "test-audit-" + Date.now(),
        user_id: testUserId,
        session_id: testSessionId,
        role: "user" as const,
        content: "Log my breakfast of eggs and toast",
        tool_name: null,
        tool_input: null,
        tool_output: null,
        timestamp: new Date().toISOString(),
      };

      await addAuditLog(log);
      expect(true).toBe(true);
    });

    test("should search audit logs semantically", async () => {
      // Add another log entry
      await addAuditLog({
        id: "test-audit-2-" + Date.now(),
        user_id: testUserId,
        session_id: testSessionId,
        role: "assistant" as const,
        content: "I logged 2 eggs and 1 slice of whole wheat toast for breakfast",
        tool_name: "logMeal",
        tool_input: JSON.stringify({ foodName: "eggs", quantity: 2 }),
        tool_output: JSON.stringify({ success: true }),
        timestamp: new Date().toISOString(),
      });

      const results = await searchAuditLogs(testUserId, "breakfast eggs", 5);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
