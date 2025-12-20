import lancedb from "@lancedb/lancedb";
import type { Table, Connection } from "@lancedb/lancedb";
import { generateEmbedding, EMBEDDING_DIMENSION } from "./embeddings";
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
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        serving_size: "",
        source: "custom",
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
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        meal_type: "snack",
        logged_at: new Date().toISOString(),
        notes: "",
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
    await conn.createTable(USER_GOALS_TABLE, [
      {
        user_id: "__init__",
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sodium: 0,
        sugar: 0,
        updated_at: new Date().toISOString(),
      },
    ]);
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

  await table.add([{
    ...food,
    brand: food.brand ?? "",
    barcode: food.barcode ?? "",
    vector,
  }]);
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
    return {
      id: r.id as string,
      name: r.name as string,
      brand: brand === "" ? null : brand,
      barcode: barcode === "" ? null : barcode,
      calories: r.calories as number,
      protein: r.protein as number,
      carbs: r.carbs as number,
      fat: r.fat as number,
      serving_size: r.serving_size as string,
      source: r.source as "openfoodfacts" | "usda" | "custom",
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
  return {
    id: r.id as string,
    name: r.name as string,
    brand: brand === "" ? null : brand,
    barcode: barcodeVal === "" ? null : barcodeVal,
    calories: r.calories as number,
    protein: r.protein as number,
    carbs: r.carbs as number,
    fat: r.fat as number,
    serving_size: r.serving_size as string,
    source: r.source as "openfoodfacts" | "usda" | "custom",
  };
}

// Meal log operations

export async function addMealLog(meal: MealLogInput): Promise<void> {
  const table = await getMealLogsTable();
  const searchText = [meal.food_name, meal.meal_type, meal.notes]
    .filter(Boolean)
    .join(" ");
  const vector = await generateEmbedding(searchText);

  await table.add([{
    ...meal,
    food_id: meal.food_id ?? "",
    notes: meal.notes ?? "",
    vector,
  }]);
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

  return results.map((r) => {
    const food_id = r.food_id as string;
    const notes = r.notes as string;
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      food_id: food_id === "" ? null : food_id,
      food_name: r.food_name as string,
      quantity: r.quantity as number,
      unit: r.unit as string,
      calories: r.calories as number,
      protein: r.protein as number,
      carbs: r.carbs as number,
      fat: r.fat as number,
      meal_type: r.meal_type as "breakfast" | "lunch" | "dinner" | "snack",
      logged_at: r.logged_at as string,
      notes: notes === "" ? null : notes,
    };
  });
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

  return results.map((r) => {
    const food_id = r.food_id as string;
    const notes = r.notes as string;
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      food_id: food_id === "" ? null : food_id,
      food_name: r.food_name as string,
      quantity: r.quantity as number,
      unit: r.unit as string,
      calories: r.calories as number,
      protein: r.protein as number,
      carbs: r.carbs as number,
      fat: r.fat as number,
      meal_type: r.meal_type as "breakfast" | "lunch" | "dinner" | "snack",
      logged_at: r.logged_at as string,
      notes: notes === "" ? null : notes,
    };
  });
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

  return results.map((r) => {
    const food_id = r.food_id as string;
    const notes = r.notes as string;
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      food_id: food_id === "" ? null : food_id,
      food_name: r.food_name as string,
      quantity: r.quantity as number,
      unit: r.unit as string,
      calories: r.calories as number,
      protein: r.protein as number,
      carbs: r.carbs as number,
      fat: r.fat as number,
      meal_type: r.meal_type as "breakfast" | "lunch" | "dinner" | "snack",
      logged_at: r.logged_at as string,
      notes: notes === "" ? null : notes,
    };
  });
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

  await table.add([{
    user_id: goals.user_id,
    calories: goals.calories,
    protein: goals.protein ?? 0,
    carbs: goals.carbs ?? 0,
    fat: goals.fat ?? 0,
    fiber: goals.fiber ?? 0,
    sodium: goals.sodium ?? 0,
    sugar: goals.sugar ?? 0,
    updated_at: goals.updated_at,
  }]);
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
  const protein = r.protein as number;
  const carbs = r.carbs as number;
  const fat = r.fat as number;
  const fiber = r.fiber as number;
  const sodium = r.sodium as number;
  const sugar = r.sugar as number;

  return {
    user_id: r.user_id as string,
    calories: r.calories as number,
    protein: protein === 0 ? null : protein,
    carbs: carbs === 0 ? null : carbs,
    fat: fat === 0 ? null : fat,
    fiber: fiber === 0 ? null : fiber,
    sodium: sodium === 0 ? null : sodium,
    sugar: sugar === 0 ? null : sugar,
    updated_at: r.updated_at as string,
  };
}

// Audit log operations

export async function addAuditLog(log: AuditLogInput): Promise<void> {
  const table = await getAuditLogsTable();
  const searchText = [log.content, log.tool_name].filter(Boolean).join(" ");
  const vector = await generateEmbedding(searchText);

  await table.add([{
    ...log,
    tool_name: log.tool_name ?? "",
    tool_input: log.tool_input ?? "",
    tool_output: log.tool_output ?? "",
    vector,
  }]);
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

// Re-export schemas
export * from "./schemas";
export { generateEmbedding, generateEmbeddings, EMBEDDING_DIMENSION } from "./embeddings";
