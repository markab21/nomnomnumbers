import lancedb from "@lancedb/lancedb";
import type { Table, Connection } from "@lancedb/lancedb";
import { generateEmbedding, EMBEDDING_DIMENSION } from "./embeddings";
import {
  NUTRIENT_KEYS,
  toStorageNutrition,
  fromStorageNutrition,
  type FullNutrition,
  type NutrientKey,
} from "./nutrient-fields";
import type {
  FoodInput,
  MealLogInput,
  AuditLogInput,
  UserGoals,
} from "./schemas";

// Database path - can be overridden for testing
let dbPath = process.env.LANCE_DB_PATH || "./data/lance";

// Table names
const FOODS_TABLE = "foods";
const MEAL_LOGS_TABLE = "meal_logs";
const AUDIT_LOGS_TABLE = "audit_logs";
const USER_GOALS_TABLE = "user_goals";

// Singleton connection
let db: Connection | null = null;

/**
 * Set database path (useful for testing)
 */
export function setDbPath(path: string): void {
  dbPath = path;
  db = null; // Reset connection when path changes
}

/**
 * Get current database path
 */
export function getDbPath(): string {
  return dbPath;
}

/**
 * Reset database connection (useful for testing)
 */
export async function resetDb(): Promise<void> {
  db = null;
}

/**
 * Get or create database connection
 */
export async function getDb(): Promise<Connection> {
  if (!db) {
    db = await lancedb.connect(dbPath);
  }
  return db;
}

/**
 * Check if a table exists
 */
async function tableExists(tableName: string): Promise<boolean> {
  const conn = await getDb();
  const tables = await conn.tableNames();
  return tables.includes(tableName);
}

/**
 * Initialize tables - creates empty arrays to represent schemas
 * Tables will be created on first data insert
 */
export async function initializeTables(): Promise<void> {
  // Tables are created lazily on first insert
  // This function just ensures the database connection is ready
  await getDb();
}

/**
 * Create default nutrition record for table initialization
 */
function createDefaultNutritionRecord(): Record<NutrientKey, number> {
  const record: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    record[key] = 0;
  }
  return record as Record<NutrientKey, number>;
}

/**
 * Goal nutrient keys (subset of all nutrients that can have goals)
 */
const GOAL_NUTRIENT_KEYS = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "fiber_g",
  "sugar_g",
  "net_carbs",
  "cholesterol_mg",
  "saturated_fat_g",
  "sodium_mg",
  "omega_3_g",
  "omega_6_g",
  "vitamin_a_ug",
  "vitamin_c_mg",
  "vitamin_d_ug",
  "vitamin_e_mg",
  "vitamin_k_ug",
  "vitamin_b12_ug",
  "folate_ug",
  "calcium_mg",
  "iron_mg",
  "magnesium_mg",
  "potassium_mg",
  "zinc_mg",
] as const;

/**
 * Get or create foods table
 */
export async function getFoodsTable(): Promise<Table> {
  const conn = await getDb();
  if (!(await tableExists(FOODS_TABLE))) {
    const sampleVector = new Array(EMBEDDING_DIMENSION).fill(0);
    await conn.createTable(FOODS_TABLE, [
      {
        id: "__init__",
        name: "__init__",
        brand: "",
        barcode: "",
        serving_size: "",
        serving_grams: 0,
        source: "custom",
        ...createDefaultNutritionRecord(),
        vector: sampleVector,
      },
    ]);
    const table = await conn.openTable(FOODS_TABLE);
    await table.delete(`id = '__init__'`);
    return table;
  }
  return conn.openTable(FOODS_TABLE);
}

/**
 * Get or create meal_logs table
 */
export async function getMealLogsTable(): Promise<Table> {
  const conn = await getDb();
  if (!(await tableExists(MEAL_LOGS_TABLE))) {
    const sampleVector = new Array(EMBEDDING_DIMENSION).fill(0);
    await conn.createTable(MEAL_LOGS_TABLE, [
      {
        id: "__init__",
        user_id: "__init__",
        food_id: "",
        food_name: "__init__",
        quantity: 0,
        unit: "",
        meal_type: "snack",
        logged_at: new Date().toISOString(),
        notes: "",
        ...createDefaultNutritionRecord(),
        vector: sampleVector,
      },
    ]);
    const table = await conn.openTable(MEAL_LOGS_TABLE);
    await table.delete(`id = '__init__'`);
    return table;
  }
  return conn.openTable(MEAL_LOGS_TABLE);
}

/**
 * Get or create audit_logs table
 */
export async function getAuditLogsTable(): Promise<Table> {
  const conn = await getDb();
  if (!(await tableExists(AUDIT_LOGS_TABLE))) {
    const sampleVector = new Array(EMBEDDING_DIMENSION).fill(0);
    await conn.createTable(AUDIT_LOGS_TABLE, [
      {
        id: "__init__",
        user_id: "__init__",
        session_id: "__init__",
        role: "user",
        content: "__init__",
        tool_name: "",
        tool_input: "",
        tool_output: "",
        timestamp: new Date().toISOString(),
        vector: sampleVector,
      },
    ]);
    const table = await conn.openTable(AUDIT_LOGS_TABLE);
    await table.delete(`id = '__init__'`);
    return table;
  }
  return conn.openTable(AUDIT_LOGS_TABLE);
}

/**
 * Get or create user_goals table
 */
export async function getUserGoalsTable(): Promise<Table> {
  const conn = await getDb();
  if (!(await tableExists(USER_GOALS_TABLE))) {
    const goalRecord: Record<string, number | string> = {
      user_id: "__init__",
      updated_at: new Date().toISOString(),
    };
    for (const key of GOAL_NUTRIENT_KEYS) {
      goalRecord[key] = 0;
    }
    await conn.createTable(USER_GOALS_TABLE, [goalRecord]);
    const table = await conn.openTable(USER_GOALS_TABLE);
    await table.delete(`user_id = '__init__'`);
    return table;
  }
  return conn.openTable(USER_GOALS_TABLE);
}

// Food operations

export async function addFood(food: FoodInput): Promise<void> {
  const table = await getFoodsTable();
  const searchText = [food.name, food.brand].filter(Boolean).join(" ");
  const vector = await generateEmbedding(searchText);

  // Convert nutrition to storage format (nulls -> 0)
  const nutritionStorage = toStorageNutrition(food);

  await table.add([
    {
      id: food.id,
      name: food.name,
      brand: food.brand ?? "",
      barcode: food.barcode ?? "",
      serving_size: food.serving_size,
      serving_grams: food.serving_grams ?? 0,
      source: food.source,
      ...nutritionStorage,
      vector,
    },
  ]);
}

export async function searchFoods(
  query: string,
  limit: number = 10
): Promise<FoodInput[]> {
  const table = await getFoodsTable();
  const queryVector = await generateEmbedding(query);

  const results = await table.search(queryVector).limit(limit).toArray();

  return results.map((r) => {
    const brand = r.brand as string;
    const barcode = r.barcode as string;
    const serving_grams = r.serving_grams as number;

    // Extract nutrition from storage
    const nutritionStorage: Record<string, number> = {};
    for (const key of NUTRIENT_KEYS) {
      nutritionStorage[key] = (r[key] as number) ?? 0;
    }
    const nutrition = fromStorageNutrition(nutritionStorage);

    return {
      id: r.id as string,
      name: r.name as string,
      brand: brand === "" ? null : brand,
      barcode: barcode === "" ? null : barcode,
      serving_size: r.serving_size as string,
      serving_grams: serving_grams === 0 ? null : serving_grams,
      source: r.source as "openfoodfacts" | "usda" | "usda-local" | "custom",
      ...nutrition,
    };
  });
}

export async function getFoodByBarcode(
  barcode: string
): Promise<FoodInput | null> {
  const table = await getFoodsTable();
  const results = await table
    .query()
    .where(`barcode = '${barcode}'`)
    .limit(1)
    .toArray();

  if (results.length === 0) return null;

  const r = results[0];
  const brand = r.brand as string;
  const barcodeVal = r.barcode as string;
  const serving_grams = r.serving_grams as number;

  // Extract nutrition from storage
  const nutritionStorage: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    nutritionStorage[key] = (r[key] as number) ?? 0;
  }
  const nutrition = fromStorageNutrition(nutritionStorage);

  return {
    id: r.id as string,
    name: r.name as string,
    brand: brand === "" ? null : brand,
    barcode: barcodeVal === "" ? null : barcodeVal,
    serving_size: r.serving_size as string,
    serving_grams: serving_grams === 0 ? null : serving_grams,
    source: r.source as "openfoodfacts" | "usda" | "usda-local" | "custom",
    ...nutrition,
  };
}

// Meal log operations

export async function addMealLog(meal: MealLogInput): Promise<void> {
  const table = await getMealLogsTable();
  const searchText = [meal.food_name, meal.meal_type, meal.notes]
    .filter(Boolean)
    .join(" ");
  const vector = await generateEmbedding(searchText);

  // Convert nutrition to storage format
  const nutritionStorage = toStorageNutrition(meal);

  await table.add([
    {
      id: meal.id,
      user_id: meal.user_id,
      food_id: meal.food_id ?? "",
      food_name: meal.food_name,
      quantity: meal.quantity,
      unit: meal.unit,
      meal_type: meal.meal_type,
      logged_at: meal.logged_at,
      notes: meal.notes ?? "",
      ...nutritionStorage,
      vector,
    },
  ]);
}

/**
 * Helper to convert meal log from storage
 */
function mealFromStorage(r: Record<string, unknown>): MealLogInput {
  const food_id = r.food_id as string;
  const notes = r.notes as string;

  // Extract nutrition from storage
  const nutritionStorage: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    nutritionStorage[key] = (r[key] as number) ?? 0;
  }
  const nutrition = fromStorageNutrition(nutritionStorage);

  return {
    id: r.id as string,
    user_id: r.user_id as string,
    food_id: food_id === "" ? null : food_id,
    food_name: r.food_name as string,
    quantity: r.quantity as number,
    unit: r.unit as string,
    meal_type: r.meal_type as "breakfast" | "lunch" | "dinner" | "snack",
    logged_at: r.logged_at as string,
    notes: notes === "" ? null : notes,
    ...nutrition,
  };
}

export async function getMealsByDate(
  userId: string,
  date: string
): Promise<MealLogInput[]> {
  const table = await getMealLogsTable();
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const results = await table
    .query()
    .where(
      `user_id = '${userId}' AND logged_at >= '${startOfDay}' AND logged_at <= '${endOfDay}'`
    )
    .toArray();

  return results.map(mealFromStorage);
}

export async function getMealHistory(
  userId: string,
  startDate?: string,
  endDate?: string,
  limit: number = 20
): Promise<MealLogInput[]> {
  const table = await getMealLogsTable();

  let whereClause = `user_id = '${userId}'`;
  if (startDate) {
    whereClause += ` AND logged_at >= '${startDate}T00:00:00'`;
  }
  if (endDate) {
    whereClause += ` AND logged_at <= '${endDate}T23:59:59'`;
  }

  const results = await table.query().where(whereClause).limit(limit).toArray();

  return results.map(mealFromStorage);
}

export async function searchMealLogs(
  userId: string,
  query: string,
  limit: number = 10
): Promise<MealLogInput[]> {
  const table = await getMealLogsTable();
  const queryVector = await generateEmbedding(query);

  const results = await table
    .search(queryVector)
    .where(`user_id = '${userId}'`)
    .limit(limit)
    .toArray();

  return results.map(mealFromStorage);
}

// User goals operations

export async function setUserGoals(goals: UserGoals): Promise<void> {
  const table = await getUserGoalsTable();

  const existing = await table
    .query()
    .where(`user_id = '${goals.user_id}'`)
    .limit(1)
    .toArray();

  if (existing.length > 0) {
    await table.delete(`user_id = '${goals.user_id}'`);
  }

  // Build storage record with all goal fields
  const goalRecord: Record<string, number | string> = {
    user_id: goals.user_id,
    updated_at: goals.updated_at,
  };

  for (const key of GOAL_NUTRIENT_KEYS) {
    const value = goals[key as keyof UserGoals];
    goalRecord[key] = typeof value === "number" ? value : 0;
  }

  await table.add([goalRecord]);
}

export async function getUserGoals(userId: string): Promise<UserGoals | null> {
  const table = await getUserGoalsTable();
  const results = await table
    .query()
    .where(`user_id = '${userId}'`)
    .limit(1)
    .toArray();

  if (results.length === 0) return null;

  const r = results[0];

  // Build goals object, converting 0 back to undefined
  const goals: Record<string, unknown> = {
    user_id: r.user_id as string,
    updated_at: r.updated_at as string,
  };

  for (const key of GOAL_NUTRIENT_KEYS) {
    const value = r[key] as number;
    // Calories is required, others are optional (0 = not set)
    if (key === "calories") {
      goals[key] = value;
    } else {
      goals[key] = value === 0 ? undefined : value;
    }
  }

  return goals as UserGoals;
}

// Audit log operations

export async function addAuditLog(log: AuditLogInput): Promise<void> {
  const table = await getAuditLogsTable();
  const searchText = [log.content, log.tool_name].filter(Boolean).join(" ");
  const vector = await generateEmbedding(searchText);

  await table.add([
    {
      ...log,
      tool_name: log.tool_name ?? "",
      tool_input: log.tool_input ?? "",
      tool_output: log.tool_output ?? "",
      vector,
    },
  ]);
}

export async function searchAuditLogs(
  userId: string,
  query: string,
  limit: number = 20
): Promise<AuditLogInput[]> {
  const table = await getAuditLogsTable();
  const queryVector = await generateEmbedding(query);

  const results = await table
    .search(queryVector)
    .where(`user_id = '${userId}'`)
    .limit(limit)
    .toArray();

  return results.map((r) => {
    const tool_name = r.tool_name as string;
    const tool_input = r.tool_input as string;
    const tool_output = r.tool_output as string;
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      session_id: r.session_id as string,
      role: r.role as "user" | "assistant" | "tool",
      content: r.content as string,
      tool_name: tool_name === "" ? null : tool_name,
      tool_input: tool_input === "" ? null : tool_input,
      tool_output: tool_output === "" ? null : tool_output,
      timestamp: r.timestamp as string,
    };
  });
}

// Re-export schemas and nutrient fields
export * from "./schemas";
export * from "./nutrient-fields";
export { generateEmbedding, generateEmbeddings, EMBEDDING_DIMENSION } from "./embeddings";
