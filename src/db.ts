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
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config", "nomnom");
}

function getDefaultDataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "nomnom");
  }
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share", "nomnom");
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
      return {
        dataDir: parsed.dataDir || DATA_DIR,
        usdaDbPath: parsed.usdaDbPath || join(DATA_DIR, "usda", "usda_fdc.sqlite"),
        mealDbPath: parsed.mealDbPath || join(DATA_DIR, "nomnom.db"),
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
  saveConfig(cfg);
  config = cfg;
  db = null;
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
      usdaDb = new Database(cfg.usdaDbPath, { readonly: true });
    }
    return usdaDb;
  } catch {
    return null;
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
  `);
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

  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const ftsQuery = words.join(" ");
  
  const stmt = usda.query(`
    SELECT 
      f.fdc_id,
      f.description,
      b.brand_owner,
      b.gtin_upc,
      b.household_serving,
      b.serving_size,
      b.serving_size_unit
    FROM food_fts
    JOIN food f ON food_fts.fdc_id = f.fdc_id
    LEFT JOIN branded_food b ON f.fdc_id = b.fdc_id
    WHERE food_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  const rows = stmt.all(ftsQuery, limit) as Array<{
    fdc_id: number;
    description: string;
    brand_owner: string | null;
    gtin_upc: string | null;
    household_serving: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
  }>;

  return rows.map((row) => {
    const nutrients = getNutrients(usda!, row.fdc_id);
    const servingSize = row.household_serving ||
      (row.serving_size && row.serving_size_unit 
        ? `${row.serving_size}${row.serving_size_unit}` 
        : null);

    return {
      fdcId: row.fdc_id,
      description: row.description,
      brand: row.brand_owner,
      barcode: row.gtin_upc,
      servingSize,
      ...nutrients,
    };
  });
}

function getNutrients(db: Database, fdcId: number): Record<string, number | null> {
  const stmt = db.query(`
    SELECT n.name, fn.amount
    FROM food_nutrient fn
    JOIN nutrient n ON fn.nutrient_id = n.id
    WHERE fn.fdc_id = ?
  `);

  const rows = stmt.all(fdcId) as Array<{ name: string; amount: number | null }>;

  const nutrients: Record<string, number | null> = {
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
    sugar: null,
    sodium: null,
  };

  for (const row of rows) {
    const name = row.name.toLowerCase();
    if (name === "energy") nutrients.calories = row.amount;
    else if (name === "protein") nutrients.protein = row.amount;
    else if (name === "carbohydrate, by difference") nutrients.carbs = row.amount;
    else if (name === "total lipid (fat)") nutrients.fat = row.amount;
    else if (name.includes("fiber")) nutrients.fiber = row.amount;
    else if (name.includes("sugars")) nutrients.sugar = row.amount;
    else if (name.includes("sodium")) nutrients.sodium = row.amount;
  }

  return nutrients;
}

export function lookupBarcode(barcode: string): FoodResult | null {
  const usda = getUSDAConnection();
  if (!usda) return null;

  const stmt = usda.query(`
    SELECT 
      f.fdc_id,
      f.description,
      b.brand_owner,
      b.gtin_upc,
      b.household_serving,
      b.serving_size,
      b.serving_size_unit
    FROM branded_food b
    JOIN food f ON b.fdc_id = f.fdc_id
    WHERE b.gtin_upc = ?
    LIMIT 1
  `);

  const row = stmt.get(barcode) as {
    fdc_id: number;
    description: string;
    brand_owner: string | null;
    gtin_upc: string | null;
    household_serving: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
  } | null;

  if (!row) return null;

  const nutrients = getNutrients(usda, row.fdc_id);
  const servingSize = row.household_serving ||
    (row.serving_size && row.serving_size_unit 
      ? `${row.serving_size}${row.serving_size_unit}` 
      : null);

  return {
    fdcId: row.fdc_id,
    description: row.description,
    brand: row.brand_owner,
    barcode: row.gtin_upc,
    servingSize,
    ...nutrients,
  };
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
    input.foodId || null,
    input.barcode || null,
    input.quantity,
    input.unit || "serving",
    input.mealType || "snack",
    input.notes || null,
    input.calories || null,
    input.protein || null,
    input.carbs || null,
    input.fat || null,
    input.fiber || null,
    input.sugar || null,
    input.sodium || null
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
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    mealCount: row.meal_count,
  };
}

export function isUSDBAvailable(): boolean {
  return getUSDAConnection() !== null;
}

export function getUSDAPath(): string {
  return getConfig().usdaDbPath;
}
