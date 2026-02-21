import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, createWriteStream, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const CONFIG_DIR = process.env.NOMNOM_CONFIG_DIR || getDefaultConfigDir();
const DATA_DIR = process.env.NOMNOM_DATA_DIR || getDefaultDataDir();
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const USDA_RELEASE_URL = process.env.NOMNOM_USDA_URL || 
  "https://github.com/markab21/nomnomnumbers/releases/download/usda/usda_fdc.sqlite.gz";

interface Config {
  dataDir: string;
  usdaDbPath: string;
  mealDbPath: string;
}

interface InitResult {
  initialized: boolean;
  dataDir: string;
  mealDbCreated: boolean;
  usdaExists: boolean;
}

function getDefaultConfigDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "nomnom");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nomnom");
}

function getDefaultDataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "nomnom");
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "nomnom");
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureDir(CONFIG_DIR);
  ensureDir(DATA_DIR);

  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const dataDir = parsed.dataDir || DATA_DIR;
      return {
        dataDir,
        usdaDbPath: parsed.usdaDbPath || join(dataDir, "usda", "usda_fdc.sqlite"),
        mealDbPath: parsed.mealDbPath || join(dataDir, "nomnom.db"),
      };
    } catch {
      // Invalid config, use defaults
    }
  }

  return {
    dataDir: DATA_DIR,
    usdaDbPath: join(DATA_DIR, "usda", "usda_fdc.sqlite"),
    mealDbPath: join(DATA_DIR, "nomnom.db"),
  };
}

export function saveConfig(config: Partial<Config>): void {
  const current = loadConfig();
  const updated = { ...current, ...config };
  
  ensureDir(dirname(CONFIG_FILE));
  writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
}

export function getConfigPaths(): { configDir: string; dataDir: string; configFile: string } {
  return { configDir: CONFIG_DIR, dataDir: DATA_DIR, configFile: CONFIG_FILE };
}

export function resetConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    rmSync(CONFIG_FILE);
  }
}

let db: Database | null = null;
let usdaDb: Database | null = null;
let config: Config | null = null;

function getConfig(): Config {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

export function setDataDir(path: string): void {
  const cfg = getConfig();
  cfg.dataDir = path;
  cfg.mealDbPath = join(path, "nomnom.db");
  cfg.usdaDbPath = join(path, "usda", "usda_fdc.sqlite");
  saveConfig(cfg);
  config = cfg;
  db = null;
  usdaDb = null;
}

export function setUSDAPath(path: string): void {
  const cfg = getConfig();
  cfg.usdaDbPath = path;
  saveConfig(cfg);
  config = cfg;
  usdaDb = null;
}

export interface DownloadProgress {
  status: "downloading" | "extracting" | "complete" | "error";
  message: string;
  percent?: number;
}

export async function downloadUSDADatabase(
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ success: boolean; path: string; error?: string }> {
  const cfg = getConfig();
  const usdaDir = dirname(cfg.usdaDbPath);
  const tempPath = `${cfg.usdaDbPath}.downloading`;
  const gzPath = `${cfg.usdaDbPath}.gz`;
  
  ensureDir(usdaDir);
  
  try {
    onProgress?.({ status: "downloading", message: "Downloading USDA database...", percent: 0 });
    
    const response = await fetch(USDA_RELEASE_URL);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    
    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Unable to read response body");
    }
    
    const file = createWriteStream(gzPath);
    let downloadedBytes = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      file.write(value);
      downloadedBytes += value.length;
      
      if (totalBytes > 0) {
        const percent = Math.round((downloadedBytes / totalBytes) * 100);
        onProgress?.({ 
          status: "downloading", 
          message: `Downloading USDA database...`, 
          percent 
        });
      }
    }
    
    file.end();
    await new Promise<void>((resolve) => file.on("finish", () => resolve()));
    
    onProgress?.({ status: "extracting", message: "Extracting database..." });
    
    const compressed = readFileSync(gzPath);
    const decompressed = gunzipSync(compressed);
    writeFileSync(tempPath, decompressed);
    rmSync(gzPath);
    
    renameSync(tempPath, cfg.usdaDbPath);
    
    onProgress?.({ status: "complete", message: "USDA database ready!" });
    
    return { success: true, path: cfg.usdaDbPath };
  } catch (error) {
    if (existsSync(tempPath)) rmSync(tempPath);
    if (existsSync(gzPath)) rmSync(gzPath);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    onProgress?.({ status: "error", message: errorMessage });
    
    return { success: false, path: cfg.usdaDbPath, error: errorMessage };
  }
}

export function usdaDbExists(): boolean {
  return existsSync(getConfig().usdaDbPath);
}

export function initializeDatabase(): InitResult {
  const cfg = getConfig();
  
  ensureDir(cfg.dataDir);
  ensureDir(dirname(cfg.mealDbPath));
  
  const mealDbExisted = existsSync(cfg.mealDbPath);
  const usdaExists = existsSync(cfg.usdaDbPath);
  
  if (!db) {
    db = new Database(cfg.mealDbPath);
    db.exec("PRAGMA journal_mode = WAL");
    initTables(db);
  }
  
  return {
    initialized: true,
    dataDir: cfg.dataDir,
    mealDbCreated: !mealDbExisted,
    usdaExists,
  };
}

export function getDb(): Database {
  if (!db) {
    const result = initializeDatabase();
    if (result.mealDbCreated) {
      console.error(`Initialized database at ${result.dataDir}`);
    }
  }
  return db!;
}

export function getUSDAConnection(): Database | null {
  const cfg = getConfig();
  try {
    if (!usdaDb && existsSync(cfg.usdaDbPath)) {
      usdaDb = new Database(cfg.usdaDbPath);
      ensureUSDAFTS(usdaDb);
    }
    return usdaDb;
  } catch {
    return null;
  }
}

function ensureUSDAFTS(db: Database): void {
  // Check if FTS index exists; build it on first run if not
  const hasFTS = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='food_fts'"
  ).get();

  if (!hasFTS) {
    console.error("Building search index (one-time operation)...");
    db.exec(`
      CREATE VIRTUAL TABLE food_fts USING fts5(
        fdc_id UNINDEXED,
        description,
        brand
      )
    `);
    db.exec(
      "INSERT INTO food_fts(fdc_id, description, brand) SELECT fdc_id, description, brand FROM food"
    );
    console.error("Search index ready.");
  }
}

function initTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      food_name TEXT NOT NULL,
      food_id TEXT,
      barcode TEXT,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'serving',
      meal_type TEXT NOT NULL DEFAULT 'snack',
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT,
      calories REAL,
      protein REAL,
      carbs REAL,
      fat REAL,
      fiber_g REAL,
      sugar_g REAL,
      sodium_mg REAL
    );
    
    CREATE INDEX IF NOT EXISTS idx_meals_logged_at ON meals(logged_at);
    CREATE INDEX IF NOT EXISTS idx_meals_barcode ON meals(barcode);

    CREATE TABLE IF NOT EXISTS goals (
      key TEXT PRIMARY KEY,
      target REAL NOT NULL,
      direction TEXT NOT NULL DEFAULT 'under',
      tolerance REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: add tolerance column if missing (existing databases)
  try {
    db.exec("ALTER TABLE goals ADD COLUMN tolerance REAL NOT NULL DEFAULT 0");
  } catch {
    // Column already exists — ignore
  }
}

export interface FoodResult {
  fdcId: number;
  description: string;
  brand: string | null;
  barcode: string | null;
  servingSize: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
}

export interface MealResult {
  id: string;
  foodName: string;
  quantity: number;
  unit: string;
  mealType: string;
  loggedAt: string;
  notes: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export function searchFoods(query: string, limit: number = 10): FoodResult[] {
  const usda = getUSDAConnection();
  if (!usda) return [];

  // Sanitize for FTS5: strip special chars, quote each word as a literal term
  const words = query.trim()
    .replace(/["\*\+\^\(\)\{\}~|\\!:\-]/g, " ")  // Strip FTS5 operator chars only; preserve Unicode letters
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w}"`);       // Quote each word to prevent FTS5 operator injection

  if (words.length === 0) return [];

  const ftsQuery = words.join(" ");

  const rows = usda.query(`
    SELECT f.fdc_id, f.description, f.brand, f.barcode, f.data
    FROM food_fts
    JOIN food f ON food_fts.fdc_id = f.fdc_id
    WHERE food_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit) as Array<{
    fdc_id: number;
    description: string;
    brand: string | null;
    barcode: string | null;
    data: string;
  }>;

  return rows.map(rowToFoodResult);
}

function rowToFoodResult(row: {
  fdc_id: number;
  description: string;
  brand: string | null;
  barcode: string | null;
  data: string;
}): FoodResult {
  const d = JSON.parse(row.data) as Record<string, any>;
  const servingSize = d.hs ||
    (d.ss && d.su ? `${d.ss}${d.su}` : null);

  return {
    fdcId: row.fdc_id,
    description: row.description,
    brand: row.brand,
    barcode: row.barcode,
    servingSize,
    calories: d.cal ?? null,
    protein: d.protein ?? null,
    carbs: d.carbs ?? null,
    fat: d.fat ?? null,
    fiber: d.fiber ?? null,
    sugar: d.sugar ?? null,
    sodium: d.sodium ?? null,
  };
}

export function lookupBarcode(barcode: string): FoodResult | null {
  const usda = getUSDAConnection();
  if (!usda) return null;

  const row = usda.query(`
    SELECT fdc_id, description, brand, barcode, data
    FROM food
    WHERE barcode = ?
    LIMIT 1
  `).get(barcode) as {
    fdc_id: number;
    description: string;
    brand: string | null;
    barcode: string | null;
    data: string;
  } | null;

  if (!row) return null;
  return rowToFoodResult(row);
}

export function logMeal(input: {
  foodName: string;
  foodId?: string;
  barcode?: string;
  quantity: number;
  unit?: string;
  mealType?: string;
  notes?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}): string {
  const db = getDb();
  const id = crypto.randomUUID();

  const stmt = db.query(`
    INSERT INTO meals (id, food_name, food_id, barcode, quantity, unit, meal_type, notes, 
                       calories, protein, carbs, fat, fiber_g, sugar_g, sodium_mg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.foodName,
    input.foodId ?? null,
    input.barcode ?? null,
    input.quantity,
    input.unit ?? "serving",
    input.mealType ?? "snack",
    input.notes ?? null,
    input.calories ?? null,
    input.protein ?? null,
    input.carbs ?? null,
    input.fat ?? null,
    input.fiber ?? null,
    input.sugar ?? null,
    input.sodium ?? null
  );

  return id;
}

export function getMealsByDate(date: string): MealResult[] {
  const db = getDb();
  const stmt = db.query(`
    SELECT id, food_name, quantity, unit, meal_type, logged_at, notes,
           calories, protein, carbs, fat
    FROM meals
    WHERE date(logged_at) = date(?)
    ORDER BY logged_at DESC
  `);

  const rows = stmt.all(date) as Array<{
    id: string;
    food_name: string;
    quantity: number;
    unit: string;
    meal_type: string;
    logged_at: string;
    notes: string | null;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    foodName: row.food_name,
    quantity: row.quantity,
    unit: row.unit,
    mealType: row.meal_type,
    loggedAt: row.logged_at,
    notes: row.notes,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
  }));
}

export function getMealHistory(limit: number = 20): MealResult[] {
  const db = getDb();
  const stmt = db.query(`
    SELECT id, food_name, quantity, unit, meal_type, logged_at, notes,
           calories, protein, carbs, fat
    FROM meals
    ORDER BY logged_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(limit) as Array<{
    id: string;
    food_name: string;
    quantity: number;
    unit: string;
    meal_type: string;
    logged_at: string;
    notes: string | null;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    foodName: row.food_name,
    quantity: row.quantity,
    unit: row.unit,
    mealType: row.meal_type,
    loggedAt: row.logged_at,
    notes: row.notes,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
  }));
}

export function getDailyTotals(date: string): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
} {
  const db = getDb();
  const stmt = db.query(`
    SELECT 
      COALESCE(SUM(calories), 0) as calories,
      COALESCE(SUM(protein), 0) as protein,
      COALESCE(SUM(carbs), 0) as carbs,
      COALESCE(SUM(fat), 0) as fat,
      COUNT(*) as meal_count
    FROM meals
    WHERE date(logged_at) = date(?)
  `);

  const row = stmt.get(date) as {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_count: number;
  };

  return {
    calories: Math.round(row.calories * 10) / 10,
    protein: Math.round(row.protein * 10) / 10,
    carbs: Math.round(row.carbs * 10) / 10,
    fat: Math.round(row.fat * 10) / 10,
    mealCount: row.meal_count,
  };
}

export function isUSDBAvailable(): boolean {
  return getUSDAConnection() !== null;
}

export function getUSDAPath(): string {
  return getConfig().usdaDbPath;
}

// ---- Goals ----

export interface Goal {
  key: string;
  target: number;
  direction: "under" | "over";
  tolerance: number;
  updatedAt: string;
}

const VALID_GOAL_KEYS = new Set(["calories", "protein", "carbs", "fat"]);
const DEFAULT_DIRECTIONS: Record<string, "under" | "over"> = {
  calories: "under",
  protein: "over",
  carbs: "under",
  fat: "under",
};

export function setGoal(key: string, target: number, direction?: "under" | "over", tolerance?: number): void {
  if (!VALID_GOAL_KEYS.has(key)) throw new Error(`Invalid goal key: ${key}`);
  const db = getDb();
  const dir = direction ?? DEFAULT_DIRECTIONS[key] ?? "under";
  const tol = tolerance ?? 0;
  db.query(
    `INSERT INTO goals (key, target, direction, tolerance, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET target = excluded.target, direction = excluded.direction, tolerance = excluded.tolerance, updated_at = datetime('now')`
  ).run(key, target, dir, tol);
}

export function setGoalTolerance(key: string, tolerance: number): void {
  if (!VALID_GOAL_KEYS.has(key)) throw new Error(`Invalid goal key: ${key}`);
  const db = getDb();
  const existing = db.query("SELECT key FROM goals WHERE key = ?").get(key);
  if (!existing) throw new Error(`No goal set for ${key}. Set a target first.`);
  db.query(
    "UPDATE goals SET tolerance = ?, updated_at = datetime('now') WHERE key = ?"
  ).run(tolerance, key);
}

export function getGoals(): Goal[] {
  const db = getDb();
  const rows = db.query(
    `SELECT key, target, direction, tolerance, updated_at FROM goals ORDER BY key`
  ).all() as Array<{ key: string; target: number; direction: string; tolerance: number; updated_at: string }>;
  return rows.map((r) => ({
    key: r.key,
    target: r.target,
    direction: r.direction as "under" | "over",
    tolerance: r.tolerance,
    updatedAt: r.updated_at,
  }));
}

export function resetGoals(): void {
  const db = getDb();
  db.query("DELETE FROM goals").run();
}

// ---- Daily Totals (all days) ----

export interface DailyTotal {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
}

export function getAllDailyTotals(): DailyTotal[] {
  const db = getDb();
  const rows = db.query(`
    SELECT
      date(logged_at) as date,
      COALESCE(SUM(calories), 0) as calories,
      COALESCE(SUM(protein), 0) as protein,
      COALESCE(SUM(carbs), 0) as carbs,
      COALESCE(SUM(fat), 0) as fat,
      COUNT(*) as meal_count
    FROM meals
    GROUP BY date(logged_at)
    ORDER BY date ASC
  `).all() as Array<{
    date: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_count: number;
  }>;

  return rows.map((r) => ({
    date: r.date,
    calories: Math.round(r.calories * 10) / 10,
    protein: Math.round(r.protein * 10) / 10,
    carbs: Math.round(r.carbs * 10) / 10,
    fat: Math.round(r.fat * 10) / 10,
    mealCount: r.meal_count,
  }));
}
