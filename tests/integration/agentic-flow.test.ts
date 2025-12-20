import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { rm } from "node:fs/promises";
import { setDbPath, resetDb } from "../../src/db";
import {
  setGoals,
  getGoals,
  logMeal,
  getDailySummary,
  getMealHistoryTool,
  searchMeals,
  logInteraction,
  searchAuditLog,
} from "../../src/mastra/tools";

// Integration test for the full user journey: goals -> logging -> summary -> semantic search -> audit history
describe("Agentic flow integration", () => {
  const TEST_DB_PATH = "./data/lance-int";
  const userId = `integration-user-${Date.now()}`;
  const sessionId = `session-${Date.now()}`;
  const today = new Date().toISOString().split("T")[0];

  beforeAll(async () => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for agentic flow integration tests.");
    }

    // Start from a clean LanceDB store
    await rm(TEST_DB_PATH, { recursive: true, force: true });
    setDbPath(TEST_DB_PATH);
  });

  afterAll(async () => {
    await resetDb();
    await rm(TEST_DB_PATH, { recursive: true, force: true });
  });

  test("runs full nutrition assistant flow for a user", async () => {
    // 1) Set goals
    const goalsResult = await setGoals.execute({
      context: {
        userId,
        calories: 2000,
        protein: 150,
        carbs: 220,
        fat: 70,
        fiber: 30,
        sodium: 2000,
        sugar: 40,
      },
    });

    expect(goalsResult.success).toBe(true);
    expect(goalsResult.goals.calories).toBe(2000);

    const fetchedGoals = await getGoals.execute({ context: { userId } });
    expect(fetchedGoals.hasGoals).toBe(true);
    expect(fetchedGoals.goals?.protein).toBe(150);

    // 2) Log meals (breakfast, lunch, snack)
    const meals = [
      {
        foodName: "Greek yogurt with berries",
        quantity: 1,
        unit: "cup",
        mealType: "breakfast" as const,
        calories: 180,
        protein: 17,
        carbs: 20,
        fat: 3,
        notes: "Low sugar yogurt",
      },
      {
        foodName: "Grilled chicken and rice",
        quantity: 1,
        unit: "plate",
        mealType: "lunch" as const,
        calories: 550,
        protein: 45,
        carbs: 60,
        fat: 12,
        notes: "Brown rice",
      },
      {
        foodName: "Protein bar (chocolate)",
        quantity: 1,
        unit: "bar",
        mealType: "snack" as const,
        calories: 210,
        protein: 20,
        carbs: 23,
        fat: 7,
        notes: "Contains sugar alcohols",
      },
    ];

    for (const meal of meals) {
      const result = await logMeal.execute({
        context: {
          userId,
          ...meal,
        },
      });
      expect(result.success).toBe(true);
    }

    // Give LanceDB a moment to index embeddings before semantic searches
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 3) Daily summary should roll up logged meals and apply goals
    const summary = await getDailySummary.execute({ context: { userId, date: today } });
    expect(summary.mealCount).toBe(3);
    expect(summary.totalCalories).toBe(940);
    expect(summary.totalProtein).toBe(82);
    expect(summary.progress?.calories.percent).toBeGreaterThan(40);

    // 4) Semantic meal search should find the grilled chicken entry
    const search = await searchMeals.execute({
      context: { userId, query: "grilled chicken dinner", limit: 5 },
    });
    expect(search.count).toBeGreaterThan(0);
    const hasChicken = search.meals.some((m) => m.foodName.toLowerCase().includes("grilled chicken"));
    expect(hasChicken).toBe(true);

    // 5) History should return all meals for the date range
    const history = await getMealHistoryTool.execute({
      context: { userId, startDate: today, endDate: today, limit: 10 },
    });
    expect(history.count).toBe(3);
    expect(history.meals.map((m) => m.mealType)).toEqual(
      expect.arrayContaining(["breakfast", "lunch", "snack"])
    );

    // 6) Audit log round-trip: write interactions and retrieve via semantic search
    const auditEntries = [
      {
        role: "user" as const,
        content: "Please log my grilled chicken lunch",
        toolName: "log_meal",
        toolInput: JSON.stringify({ food: "grilled chicken and rice" }),
      },
      {
        role: "assistant" as const,
        content: "Logged grilled chicken and rice for lunch with 550 calories.",
        toolName: "log_meal",
        toolOutput: JSON.stringify({ success: true }),
      },
    ];

    for (const entry of auditEntries) {
      const res = await logInteraction.execute({
        context: {
          userId,
          sessionId,
          role: entry.role,
          content: entry.content,
          toolName: entry.toolName,
          toolInput: entry.toolInput,
          toolOutput: entry.toolOutput,
        },
      });
      expect(res.success).toBe(true);
    }

    const auditSearch = await searchAuditLog.execute({
      context: { userId, query: "grilled chicken lunch", limit: 5 },
    });
    expect(auditSearch.count).toBeGreaterThanOrEqual(2);
    const assistantLogged = auditSearch.interactions.some((i) =>
      i.content.toLowerCase().includes("logged grilled chicken")
    );
    expect(assistantLogged).toBe(true);
  });
});
