#!/usr/bin/env bun
import {
  searchFoods,
  lookupBarcode,
  logMeal,
  getMealById,
  deleteMeal,
  updateMeal,
  getMealsByDate,
  getMealHistory,
  getDailyTotals,
  isUSDBAvailable,
  loadConfig,
  saveConfig,
  getConfigPaths,
  setDataDir,
  setUSDAPath,
  resetConfig,
  initializeDatabase,
  downloadUSDADatabase,
  usdaDbExists,
  setGoal,
  setGoalTolerance,
  getGoals,
  resetGoals,
  addCustomFood,
  listCustomFoods,
  deleteCustomFood,
  searchCustomFoods,
  lookupCustomBarcode,
  addRecipe,
  listRecipes,
  getRecipeById,
  deleteRecipe,
  getRecipeSuggestions,
  type FoodResult,
  type CustomFood,
  type MealResult,
  type Recipe,
  getAllDailyTotals,
  getTrendData,
  type Goal,
  type DailyTotal,
} from "./db";
import {
  ConfigUpdatePayloadSchema,
  ConfigViewPayloadSchema,
  CustomFoodListItemSchema,
  CustomFoodSearchOutputSchema,
  DeletePayloadSchema,
  EditPayloadSchema,
  FoodOutputSchema,
  FoodsAddPayloadSchema,
  FoodsDeletePayloadSchema,
  FoodsListPayloadSchema,
  GoalsResetPayloadSchema,
  GoalsSetPayloadSchema,
  GoalsViewPayloadSchema,
  HistoryPayloadSchema,
  InitPayloadSchema,
  LogPayloadSchema,
  LookupPayloadSchema,
  MealOutputSchema,
  ProgressPayloadSchema,
  RecipeCreatePayloadSchema,
  RecipeDeletePayloadSchema,
  RecipeApplySuggestionPayloadSchema,
  RecipeListPayloadSchema,
  RecipeLogPayloadSchema,
  RecipeOutputSchema,
  SearchPayloadSchema,
  TodayPayloadSchema,
  TrendRecipeSuggestionsPayloadSchema,
  TrendsPayloadSchema,
  type CustomFoodListItem,
  type CustomFoodSearchOutput,
  type FoodOutput,
  type MealOutput,
  type RecipeOutput,
  type RecipeSuggestionOutput,
} from "./contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

function parseFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      // End-of-flags sentinel: everything after is positional
      positional.push(...args.slice(i + 1).filter(Boolean));
      break;
    } else if (arg?.startsWith("--")) {
      // Handle --flag=value syntax
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
        continue;
      }
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && (!value.startsWith("-") || /^-\d/.test(value))) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (/^-[a-zA-Z]$/.test(arg ?? "")) {
      // Handle single-letter flags like -h, -n (alphabetic only)
      const key = arg!.slice(1);
      const value = args[i + 1];
      if (value && (!value.startsWith("-") || /^-\d/.test(value))) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (arg) {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function parsePositiveInt(value: string | undefined, defaultValue: number, max: number = 100): number {
  if (value === undefined) return defaultValue;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) return defaultValue;
  return Math.min(n, max);
}

function parseNonNegativeInt(value: string | undefined, defaultValue: number, max: number = 10000): number {
  if (value === undefined) return defaultValue;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0) return defaultValue;
  return Math.min(n, max);
}

function parseOptionalFloat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);

function parseOutput<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  return schema.parse(data);
}

function formatFood(food: FoodResult): FoodOutput {
  return parseOutput(FoodOutputSchema, {
    fdcId: food.fdcId,
    description: food.description,
    brand: food.brand,
    barcode: food.barcode,
    servingSize: food.servingSize,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    fiber: food.fiber,
    netCarbs: food.netCarbs,
    sugar: food.sugar,
    sodium: food.sodium,
    source: "usda",
  });
}

function formatCustomFood(f: CustomFood): CustomFoodSearchOutput {
  return parseOutput(CustomFoodSearchOutputSchema, {
    id: f.id,
    description: f.description,
    brand: f.brand,
    barcode: f.barcode,
    servingSize: f.servingSize,
    calories: f.calories,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat,
    fiber: f.fiber,
    netCarbs: f.netCarbs,
    sugar: f.sugar,
    sodium: f.sodium,
    source: "custom",
  });
}

function formatMeal(meal: MealResult): MealOutput {
  return parseOutput(MealOutputSchema, {
    id: meal.id,
    foodName: meal.foodName,
    quantity: meal.quantity,
    unit: meal.unit,
    mealType: meal.mealType,
    loggedAt: meal.loggedAt,
    notes: meal.notes,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    fiber: meal.fiber,
    netCarbs: meal.netCarbs,
  });
}

function formatCustomFoodListItem(food: CustomFood): CustomFoodListItem {
  return parseOutput(CustomFoodListItemSchema, {
    id: food.id,
    name: food.description,
    brand: food.brand,
    barcode: food.barcode,
    servingSize: food.servingSize,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    fiber: food.fiber,
    netCarbs: food.netCarbs,
    sugar: food.sugar,
    sodium: food.sodium,
    createdAt: food.createdAt,
  });
}

function formatRecipe(recipe: Recipe): RecipeOutput {
  return parseOutput(RecipeOutputSchema, {
    id: recipe.id,
    name: recipe.name,
    servingSize: recipe.servingSize,
    calories: recipe.calories,
    protein: recipe.protein,
    carbs: recipe.carbs,
    fat: recipe.fat,
    fiber: recipe.fiber,
    netCarbs: recipe.netCarbs,
    sugar: recipe.sugar,
    sodium: recipe.sodium,
    createdAt: recipe.createdAt,
  });
}

function formatNutritionSummary(values: {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber?: number | null;
  netCarbs?: number | null;
}): string {
  const carbSummary = values.netCarbs === null || values.netCarbs === undefined
    ? `${values.carbs ?? "?"}c`
    : `${values.carbs ?? "?"}c (${values.netCarbs} net)`;
  const fiberSummary = values.fiber === null || values.fiber === undefined
    ? ""
    : ` | ${values.fiber} fiber`;
  return `${values.calories ?? "?"} cal | ${values.protein ?? "?"}p ${carbSummary} ${values.fat ?? "?"}f${fiberSummary}`;
}

function scaleNutrition(value: number | null, multiplier: number): number | null {
  if (value === null) return null;
  return Math.round(value * multiplier * 10) / 10;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRecipeCreateCommand(name: string, nutrition: {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar?: number | null;
  sodium?: number | null;
}): string {
  const args = ["nomnom", "recipe", "create", shellQuote(name)];
  const fields: Array<[string, number | null]> = [
    ["calories", nutrition.calories],
    ["protein", nutrition.protein],
    ["carbs", nutrition.carbs],
    ["fat", nutrition.fat],
    ["fiber", nutrition.fiber],
    ["sugar", nutrition.sugar ?? null],
    ["sodium", nutrition.sodium ?? null],
  ];

  for (const [key, value] of fields) {
    if (value !== null) {
      args.push(`--${key}`, String(value));
    }
  }

  return args.join(" ");
}

function buildApplySuggestionCommand(id: string, days: number, minOccurrences: number): string {
  return `nomnom trends apply-suggestion ${shellQuote(id)} --days ${days} --min-occurrences ${minOccurrences}`;
}

function getUSDAHelp(): string {
  const config = loadConfig();
  const usdaDir = join(config.dataDir, "usda");
  return `USDA database not found. To enable food search and barcode lookup:

  Run: nomnom init --download-usda

Or manually:
  1. Download: https://fdc.nal.usda.gov/download-datasets/
  2. Save zip to: ${usdaDir}/FoodData_Central_csv_2025-12-18.zip
  3. Run: bun run import:usda

Or use an existing database:
  nomnom config --set-usda-path /path/to/usda_fdc.sqlite`;
}

function showHelp(): string {
  return `
nomnom - Nutrition tracking CLI for AI agents

Commands:
  init                        Initialize database (auto-runs if needed)
    --download-usda           Download USDA food database (~200MB)
    
  search <query>              Search foods by name (auto-downloads USDA if needed)
    --limit <n>               Max results (default: 10)
    
  lookup <barcode>            Lookup food by barcode (auto-downloads USDA if needed)
    
  log <food> [options]        Log a meal
    --qty <n>                 Quantity (default: 1)
    --unit <u>                Unit (default: serving)
    --type <t>                Meal type: breakfast/lunch/dinner/snack
    --calories <n>            Calories
    --protein <n>             Protein (g)
    --carbs <n>               Carbs (g)
    --fat <n>                 Fat (g)
    --fiber <n>               Fiber (g)
    --notes <text>            Notes
    
  delete <id>                 Delete a logged meal by ID

  edit <id> [options]         Edit a logged meal
    --food <name>             Food name
    --qty <n>                 Quantity
    --unit <u>                Unit
    --type <t>                Meal type
    --calories <n>            Calories
    --protein <n>             Protein (g)
    --carbs <n>               Carbs (g)
    --fat <n>                 Fat (g)
    --fiber <n>               Fiber (g)
    --notes <text>            Notes

  foods [subcommand]          Manage custom foods
    foods add <name>          Add a custom food
      --calories <n>          Calories
      --protein <n>           Protein (g)
      --carbs <n>             Carbs (g)
      --fat <n>               Fat (g)
      --fiber <n>             Fiber (g)
      --sugar <n>             Sugar (g)
      --sodium <n>            Sodium (mg)
      --serving <text>        Serving size description
      --brand <text>          Brand name
      --barcode <text>        Barcode
    foods list                List all custom foods
    foods delete <id>         Delete a custom food

  recipe [subcommand]         Manage reusable recipe templates
    recipe create <name>      Save a reusable recipe template
      --calories <n>          Calories
      --protein <n>           Protein (g)
      --carbs <n>             Carbs (g)
      --fat <n>               Fat (g)
      --fiber <n>             Fiber (g)
      --sugar <n>             Sugar (g)
      --sodium <n>            Sodium (mg)
      --serving <text>        Serving size description
    recipe list               List saved recipes
    recipe log <id>           Log a saved recipe
      --multiplier <n>        Multiply saved nutrition (default: 1)
      --type <t>              Meal type: breakfast/lunch/dinner/snack
      --notes <text>          Notes
    recipe delete <id>        Delete a saved recipe

  today                       Show today's meals and totals
    
  history [options]           Show meal history
    --limit <n>               Max results (default: 20)
    --offset <n>              Skip first N results (default: 0)
    
  trends [options]            Show nutrition trends over time
    --days <n>                Number of days to analyze (default: 7, max: 90)
    suggest-recipes           Suggest recipe templates from repeated combos
      --days <n>              Lookback window (default: 30, max: 180)
      --min-occurrences <n>   Minimum repeated days to suggest (default: 3)
    apply-suggestion <id>     Turn a suggestion into a saved recipe
      --days <n>              Lookback window used to resolve the suggestion (default: 30)
      --min-occurrences <n>   Minimum repeated days used to resolve the suggestion (default: 3)
    
  goals [options]              View or set daily nutrition goals
    --calories <n>             Daily calorie target
    --protein <n>              Daily protein target (g)
    --carbs <n>                Daily carbs target (g)
    --fat <n>                  Daily fat target (g)
    --netCarbs <n>             Daily net carbs target (g)
    --<macro>-direction <d>    Goal direction: under or over
    --<macro>-tolerance <n>    Tolerance percentage (0-100) for grace zone
    --reset                    Clear all goals

  progress [options]           Show progress vs goals (streaks, weekly avg)
    --date <n>                 Day offset (0=today, -1=yesterday)

  config [options]            View or set configuration
    --set-data-dir <path>     Set data directory
    --set-usda-path <path>    Set USDA database path
    --reset                   Reset to defaults

  mcp                         Start MCP server (stdio transport)
    
  help                        Show this help

Environment Variables:
  NOMNOM_DATA_DIR    Override data directory
  NOMNOM_CONFIG_DIR  Override config directory

Output is JSON by default. Add --human or -h for readable format.
`;
}

function computeDateStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeZone(
  actual: number,
  target: number,
  direction: "under" | "over",
  tolerance: number
): { zone: "met" | "near" | "over" | "under"; band: number } {
  if (direction === "under") {
    const band = Math.round(target * (1 + tolerance / 100) * 10) / 10;
    if (actual <= target) return { zone: "met", band };
    if (actual <= band) return { zone: "near", band };
    return { zone: "over", band };
  } else {
    const band = Math.round(target * (1 - tolerance / 100) * 10) / 10;
    if (actual >= target) return { zone: "met", band };
    if (actual >= band) return { zone: "near", band };
    return { zone: "under", band };
  }
}

export async function executeCommand(argv: string[]): Promise<CommandResult> {
  let stdoutBuf = "";
  let stderrBuf = "";

  function out(s: string): void {
    stdoutBuf += s + "\n";
  }

  function err(s: string): void {
    stderrBuf += s + "\n";
  }

  let humanMode = false;

  function printResult(data: unknown, human?: string): void {
    if (humanMode) {
      out(human || JSON.stringify(data, null, 2));
    } else {
      out(JSON.stringify(data, null, 2));
    }
  }

  function printError(message: string): never {
    throw new CliError(message);
  }

  async function ensureUSDA(autoDownload: boolean = true): Promise<{ ready: boolean; error?: string }> {
    if (isUSDBAvailable()) {
      return { ready: true };
    }

    if (!autoDownload) {
      return { ready: false, error: getUSDAHelp() };
    }

    err("USDA database not found. Downloading...");

    const result = await downloadUSDADatabase((progress) => {
      if (progress.status === "downloading" && progress.percent !== undefined) {
        err(`  ${progress.message} ${progress.percent}%`);
      } else {
        err(`  ${progress.message}`);
      }
    });

    if (result.success) {
      err("USDA database downloaded successfully!\n");
      return { ready: true };
    }

    return { ready: false, error: `Failed to download USDA database: ${result.error}` };
  }

  try {
    const command = argv[0];

    if (!command || command === "help" || command === "--help" || command === "-h") {
      out(showHelp());
      return { stdout: stdoutBuf, stderr: stderrBuf, exitCode: 0 };
    }

    const { flags, positional } = parseFlags(argv.slice(1));
    humanMode = flags.human === "true" || flags.h === "true";

    switch (command) {
      case "init": {
        if (flags["download-usda"]) {
          const result = initializeDatabase();
          const download = await downloadUSDADatabase((progress) => {
            if (progress.status === "downloading" && progress.percent !== undefined) {
              err(`  ${progress.message} ${progress.percent}%`);
            } else {
              err(`  ${progress.message}`);
            }
          });

          printResult(
            parseOutput(InitPayloadSchema, {
              initialized: true,
              dataDir: result.dataDir,
              usdaDownloaded: download.success,
              usdaError: download.error,
            }),
            download.success
              ? `Initialized NomNom Numbers!\n\nData directory: ${result.dataDir}\nUSDA database downloaded.`
              : `Initialized NomNom Numbers!\n\nData directory: ${result.dataDir}\nFailed to download USDA database: ${download.error}`
          );
          break;
        }

        const result = initializeDatabase();
        printResult(
          parseOutput(InitPayloadSchema, {
            initialized: true,
            dataDir: result.dataDir,
            usdaExists: result.usdaExists
          }),
          result.mealDbCreated
            ? `Initialized NomNom Numbers!\n\nData directory: ${result.dataDir}\n\n${result.usdaExists ? "" : "Run 'nomnom init --download-usda' to download the USDA food database."}`
            : `Database already initialized.\n\nData directory: ${result.dataDir}\n\n${result.usdaExists ? "" : "Run 'nomnom init --download-usda' to download the USDA food database."}`
        );
        break;
      }

      case "config": {
        if (flags["set-data-dir"]) {
          setDataDir(flags["set-data-dir"]);
          printResult(
            parseOutput(ConfigUpdatePayloadSchema, { success: true, dataDir: flags["set-data-dir"] }),
            `Data directory set to: ${flags["set-data-dir"]}`
          );
          break;
        }
        if (flags["set-usda-path"]) {
          setUSDAPath(flags["set-usda-path"]);
          printResult(
            parseOutput(ConfigUpdatePayloadSchema, { success: true, usdaPath: flags["set-usda-path"] }),
            `USDA database path set to: ${flags["set-usda-path"]}`
          );
          break;
        }
        if (flags.reset) {
          resetConfig();
          printResult(
            parseOutput(ConfigUpdatePayloadSchema, { success: true }),
            "Configuration reset to defaults"
          );
          break;
        }

        const config = loadConfig();
        const paths = getConfigPaths();
        const usdaExists = existsSync(config.usdaDbPath);

        printResult(
          parseOutput(ConfigViewPayloadSchema, {
            config: {
              dataDir: config.dataDir,
              mealDbPath: config.mealDbPath,
              usdaDbPath: config.usdaDbPath,
              usdaExists: usdaExists,
            },
            paths: {
              configDir: paths.configDir,
              defaultDataDir: paths.dataDir,
              configFile: paths.configFile,
            },
          }),
          `Configuration:
  Data directory: ${config.dataDir}
  Meal database:  ${config.mealDbPath}
  USDA database:  ${config.usdaDbPath} ${usdaExists ? "(exists)" : "(not found)"}

Paths:
  Config dir:  ${paths.configDir}
  Config file: ${paths.configFile}

To change settings:
  nomnom config --set-data-dir /path/to/data
  nomnom config --set-usda-path /path/to/usda.sqlite`
        );
        break;
      }

      case "search": {
        const query = positional.join(" ");
        if (!query) printError("Usage: nomnom search <query>");
        const limit = parsePositiveInt(flags.limit, 10, 100);

        // Search custom foods first (no USDA dependency)
        const customResults = searchCustomFoods(query, limit);

        // Search USDA
        const usda = await ensureUSDA();
        let usdaResults: FoodResult[] = [];
        if (usda.ready) {
          usdaResults = searchFoods(query, limit);
        }

        const allResults = [
          ...customResults.map(formatCustomFood),
          ...usdaResults.map(formatFood),
        ];

        printResult(
          parseOutput(SearchPayloadSchema, { query, count: allResults.length, results: allResults }),
          allResults.length === 0
            ? `No results for "${query}"`
            : allResults
              .map(
                (f, i) =>
                  `${i + 1}. [${f.source}] ${f.description}${f.brand ? ` (${f.brand})` : ""}\n` +
                  `   ${formatNutritionSummary(f)}`
              )
              .join("\n\n")
        );
        break;
      }

      case "lookup": {
        const barcode = positional[0];
        if (!barcode) printError("Usage: nomnom lookup <barcode>");

        // Check custom foods first
        const customFood = lookupCustomBarcode(barcode!);
        if (customFood) {
          printResult(
            parseOutput(LookupPayloadSchema, { found: true, ...formatCustomFood(customFood) }),
            `[custom] ${customFood.description}${customFood.brand ? ` (${customFood.brand})` : ""}\n` +
            `${formatNutritionSummary(customFood)}`
          );
          break;
        }

        // Fall back to USDA
        const usda = await ensureUSDA();
        if (!usda.ready) {
          printError(usda.error || "USDA database not available");
        }
        const food = lookupBarcode(barcode!);
        if (!food) {
          printResult(parseOutput(LookupPayloadSchema, { found: false, barcode }), `Barcode ${barcode} not found`);
        } else {
          printResult(
            parseOutput(LookupPayloadSchema, { found: true, ...formatFood(food) }),
            `${food.description}${food.brand ? ` (${food.brand})` : ""}\n` +
            `${formatNutritionSummary(food)}`
          );
        }
        break;
      }

      case "delete": {
        const id = positional[0];
        if (!id) printError("Usage: nomnom delete <id>");

        const meal = getMealById(id!);
        if (!meal) printError(`Meal not found: ${id}`);

        deleteMeal(id!);

        printResult(
          parseOutput(DeletePayloadSchema, { success: true, id, foodName: meal!.foodName }),
          `Deleted: ${meal!.foodName}`
        );
        break;
      }

      case "edit": {
        const id = positional[0];
        if (!id) printError("Usage: nomnom edit <id> [--food <name>] [--qty <n>] [--calories <n>] ...");

        const existing = getMealById(id!);
        if (!existing) printError(`Meal not found: ${id}`);

        // Merge flags on top of existing values
        const merged = {
          foodName: flags.food || existing!.foodName,
          quantity: parseOptionalFloat(flags.qty) ?? existing!.quantity,
          unit: flags.unit || existing!.unit,
          mealType: flags.type || existing!.mealType,
          notes: flags.notes !== undefined ? flags.notes : existing!.notes,
          calories: flags.calories !== undefined ? parseOptionalFloat(flags.calories) ?? null : existing!.calories,
          protein: flags.protein !== undefined ? parseOptionalFloat(flags.protein) ?? null : existing!.protein,
          carbs: flags.carbs !== undefined ? parseOptionalFloat(flags.carbs) ?? null : existing!.carbs,
          fat: flags.fat !== undefined ? parseOptionalFloat(flags.fat) ?? null : existing!.fat,
          fiber: flags.fiber !== undefined ? parseOptionalFloat(flags.fiber) ?? null : existing!.fiber,
        };

        // Same validation as log
        if (!VALID_MEAL_TYPES.has(merged.mealType)) {
          printError(`Invalid meal type "${merged.mealType}". Must be one of: breakfast, lunch, dinner, snack`);
        }

        // Determine which fields changed
        const updated: string[] = [];
        if (merged.foodName !== existing!.foodName) updated.push("food");
        if (merged.quantity !== existing!.quantity) updated.push("quantity");
        if (merged.unit !== existing!.unit) updated.push("unit");
        if (merged.mealType !== existing!.mealType) updated.push("type");
        if (merged.notes !== existing!.notes) updated.push("notes");
        if (merged.calories !== existing!.calories) updated.push("calories");
        if (merged.protein !== existing!.protein) updated.push("protein");
        if (merged.carbs !== existing!.carbs) updated.push("carbs");
        if (merged.fat !== existing!.fat) updated.push("fat");
        if (merged.fiber !== existing!.fiber) updated.push("fiber");

        if (updated.length === 0) {
          printResult(
            parseOutput(EditPayloadSchema, { success: true, id, foodName: merged.foodName, updated: [] }),
            `No changes to ${merged.foodName}`
          );
          break;
        }

        updateMeal(id!, merged);

        printResult(
          parseOutput(EditPayloadSchema, { success: true, id, foodName: merged.foodName, updated }),
          `Updated ${merged.foodName}: ${updated.join(", ")}`
        );
        break;
      }

      case "log": {
        const foodName = positional.join(" ");
        if (!foodName) printError("Usage: nomnom log <food> [--qty <n>] [--calories <n>] ...");

        const quantity = parseOptionalFloat(flags.qty) ?? 1;
        const mealType = flags.type || "snack";

        if (!VALID_MEAL_TYPES.has(mealType)) {
          printError(`Invalid meal type "${mealType}". Must be one of: breakfast, lunch, dinner, snack`);
        }

        const id = logMeal({
          foodName,
          quantity,
          unit: flags.unit || "serving",
          mealType,
          notes: flags.notes,
          calories: parseOptionalFloat(flags.calories),
          protein: parseOptionalFloat(flags.protein),
          carbs: parseOptionalFloat(flags.carbs),
          fat: parseOptionalFloat(flags.fat),
          fiber: parseOptionalFloat(flags.fiber),
        });

        printResult(
          parseOutput(LogPayloadSchema, { success: true, id, foodName, quantity }),
          `Logged ${quantity} ${flags.unit || "serving"} of ${foodName}`
        );
        break;
      }

      case "today": {
        const offsetDays = parseInt(flags.date ?? "0", 10);
        const today = computeDateStr(isNaN(offsetDays) ? 0 : offsetDays);
        const meals = getMealsByDate(today);
        const totals = getDailyTotals(today);

        // Include goals/remaining if goals are set
        const goals = getGoals();
        let goalsObj: Record<string, number> | null = null;
        let remainingObj: Record<string, number> | null = null;

        if (goals.length > 0) {
          goalsObj = {};
          remainingObj = {};
          for (const g of goals) {
            goalsObj[g.key] = g.target;
            const actual = (totals as Record<string, number>)[g.key] ?? 0;
            remainingObj[g.key] = Math.round((g.target - actual) * 10) / 10;
          }
        }

        const result: {
          date: string;
          totals: typeof totals;
          meals: MealOutput[];
          goals?: Record<string, number>;
          remaining?: Record<string, number>;
        } = {
          date: today,
          totals,
          meals: meals.map(formatMeal),
        };
        if (goalsObj) result.goals = goalsObj;
        if (remainingObj) result.remaining = remainingObj;

        printResult(
          parseOutput(TodayPayloadSchema, result),
          `Today's Summary (${today})\n` +
          `${totals.mealCount} meals | ${totals.calories} cal | ${totals.protein}p ${totals.carbs}c (${totals.netCarbs} net) ${totals.fat}f\n` +
          (goalsObj && remainingObj
            ? `\nRemaining: ${Object.entries(remainingObj).map(([k, v]) => `${k}: ${v}`).join(" | ")}\n`
            : "") +
          `\n` +
          (meals.length === 0
            ? "No meals logged"
            : meals
              .map(
                (m) =>
                  `- ${m.foodName} (${m.quantity} ${m.unit}) [${m.mealType}]\n` +
                  `  ${formatNutritionSummary(m)}${m.notes ? ` | ${m.notes}` : ""} | ${m.loggedAt}`
              )
              .join("\n"))
        );
        break;
      }

      case "history": {
        const limit = parsePositiveInt(flags.limit, 20, 500);
        const offset = parseNonNegativeInt(flags.offset, 0);
        const meals = getMealHistory(limit, offset);
        printResult(
          parseOutput(HistoryPayloadSchema, { count: meals.length, offset, meals: meals.map(formatMeal) }),
          meals.length === 0
            ? "No meals in history"
            : meals
              .map(
                (m) =>
                  `${m.loggedAt} - ${m.foodName} (${m.quantity} ${m.unit})\n` +
                  `  ${formatNutritionSummary(m)}`
              )
              .join("\n\n")
        );
        break;
      }

      case "goals": {
        // Reset
        if (flags.reset) {
          resetGoals();
          printResult(parseOutput(GoalsResetPayloadSchema, { success: true }), "Goals reset");
          break;
        }

        // Set goals (at least one macro flag required)
        const macros = ["calories", "protein", "carbs", "fat", "netCarbs"] as const;
        const toSet: Array<{ key: string; target: number; direction?: "under" | "over"; tolerance?: number }> = [];
        const tolOnly: Array<{ key: string; tolerance: number }> = [];
        for (const m of macros) {
          const val = parseOptionalFloat(flags[m]);
          const tolVal = parseOptionalFloat(flags[`${m}-tolerance`]);
          if (tolVal !== undefined && (tolVal < 0 || tolVal > 100)) {
            printError(`Invalid ${m}-tolerance ${tolVal}: must be 0-100`);
          }
          if (val !== undefined) {
            const dirFlag = flags[`${m}-direction`];
            const direction = dirFlag === "over" || dirFlag === "under" ? dirFlag : undefined;
            toSet.push({ key: m, target: val, direction, tolerance: tolVal });
          } else if (tolVal !== undefined) {
            // Tolerance-only update (no new target)
            tolOnly.push({ key: m, tolerance: tolVal });
          }
        }

        if (toSet.length > 0 || tolOnly.length > 0) {
          const allKeys: string[] = [];
          for (const g of toSet) {
            setGoal(g.key, g.target, g.direction, g.tolerance);
            allKeys.push(g.key);
          }
          for (const t of tolOnly) {
            try {
              setGoalTolerance(t.key, t.tolerance);
              allKeys.push(t.key);
            } catch (e) {
              printError(e instanceof Error ? e.message : `Failed to set tolerance for ${t.key}`);
            }
          }
          printResult(
            parseOutput(GoalsSetPayloadSchema, { success: true, goalsSet: allKeys }),
            `Goals set: ${allKeys.join(", ")}`
          );
          break;
        }

        // View goals
        const goals = getGoals();
        if (goals.length === 0) {
          printResult(parseOutput(GoalsViewPayloadSchema, { goals: null }), "No goals set. Use: nomnom goals --calories 2000 --protein 120");
          break;
        }

        const goalsObj: Record<string, { target: number; direction: string; tolerance: number }> = {};
        let latestUpdate = "";
        for (const g of goals) {
          goalsObj[g.key] = { target: g.target, direction: g.direction, tolerance: g.tolerance };
          if (g.updatedAt > latestUpdate) latestUpdate = g.updatedAt;
        }

        printResult(
          parseOutput(GoalsViewPayloadSchema, { goals: { ...goalsObj, updatedAt: latestUpdate } }),
          goals
            .map((g) => {
              const tolStr = g.tolerance > 0 ? ` ±${g.tolerance}%` : "";
              return `${g.key}: ${g.target} (${g.direction}${tolStr})`;
            })
            .join("\n") + `\n\nLast updated: ${latestUpdate}`
        );
        break;
      }

      case "progress": {
        const goals = getGoals();
        if (goals.length === 0) {
          printError("No goals set. Use 'nomnom goals --calories 2000 ...' to set goals.");
        }

        const offsetDays = parseInt(flags.date ?? "0", 10);
        const targetDate = computeDateStr(isNaN(offsetDays) ? 0 : offsetDays);
        const todayTotals = getDailyTotals(targetDate);
        const allDays = getAllDailyTotals();

        // Build a map of date -> totals for fast lookup
        const dayMap = new Map<string, DailyTotal>();
        for (const d of allDays) dayMap.set(d.date, d);

        // Goals object
        const goalsObj: Record<string, { target: number; direction: string; tolerance: number }> = {};
        for (const g of goals) goalsObj[g.key] = { target: g.target, direction: g.direction, tolerance: g.tolerance };

        // Today's progress per macro
        const todayProgress: Record<string, {
          actual: number; goal: number; remaining: number; percent: number;
          tolerance: number; band: number; zone: string;
        }> = {};
        for (const g of goals) {
          const actual = todayTotals[g.key as keyof typeof todayTotals] as number;
          const remaining = g.target - actual;
          const percent = g.target === 0 ? (actual === 0 ? 100 : 999) : Math.round((actual / g.target) * 100);
          const { zone, band } = computeZone(actual, g.target, g.direction, g.tolerance);
          todayProgress[g.key] = {
            actual, goal: g.target,
            remaining: Math.round(remaining * 10) / 10,
            percent,
            tolerance: g.tolerance,
            band,
            zone,
          };
        }

        // Helper: check if a day meets a single goal
        function meetsGoal(day: DailyTotal | undefined, goal: Goal): boolean {
          if (!day || day.mealCount === 0) return false;
          const actual = day[goal.key as keyof DailyTotal] as number;
          const { zone } = computeZone(actual, goal.target, goal.direction, goal.tolerance);
          return zone === "met" || zone === "near";
        }

        // Helper: generate dates going backwards from a start date
        function datesBackward(from: string): string[] {
          const dates: string[] = [];
          const d = new Date(from + "T12:00:00");
          // Go back far enough to cover all history
          for (let i = 0; i < 1000; i++) {
            dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
            d.setDate(d.getDate() - 1);
          }
          return dates;
        }

        const datesBack = datesBackward(targetDate);

        // Compute streaks for each goal
        const streaks: Record<string, { current: number; best: number; direction: string }> = {};
        for (const g of goals) {
          // Current streak: walk backward from targetDate
          let current = 0;
          for (const date of datesBack) {
            const day = dayMap.get(date);
            if (!day || day.mealCount === 0) break;
            if (meetsGoal(day, g)) {
              current++;
            } else {
              break;
            }
          }

          // Best streak: scan all days in order
          let best = 0;
          let run = 0;
          for (const day of allDays) {
            if (meetsGoal(day, g)) {
              run++;
              if (run > best) best = run;
            } else {
              run = 0;
            }
          }

          streaks[g.key] = { current, best, direction: g.direction };
        }

        // allGoals streak
        let allCurrent = 0;
        for (const date of datesBack) {
          const day = dayMap.get(date);
          if (!day || day.mealCount === 0) break;
          if (goals.every((g) => meetsGoal(day, g))) {
            allCurrent++;
          } else {
            break;
          }
        }
        let allBest = 0;
        let allRun = 0;
        for (const day of allDays) {
          if (goals.every((g) => meetsGoal(day, g))) {
            allRun++;
            if (allRun > allBest) allBest = allRun;
          } else {
            allRun = 0;
          }
        }

        // Weekly average (7-day rolling ending at targetDate)
        const weekDates: string[] = [];
        {
          const d = new Date(targetDate + "T12:00:00");
          for (let i = 0; i < 7; i++) {
            weekDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
            d.setDate(d.getDate() - 1);
          }
        }
        let weekCal = 0, weekPro = 0, weekCarb = 0, weekNetCarb = 0, weekFat = 0, daysTracked = 0;
        for (const wd of weekDates) {
          const day = dayMap.get(wd);
          if (day && day.mealCount > 0) {
            weekCal += day.calories;
            weekPro += day.protein;
            weekCarb += day.carbs;
            weekNetCarb += day.netCarbs;
            weekFat += day.fat;
            daysTracked++;
          }
        }

        const weeklyAvg = daysTracked > 0
          ? {
            calories: Math.round((weekCal / daysTracked) * 10) / 10,
            protein: Math.round((weekPro / daysTracked) * 10) / 10,
            carbs: Math.round((weekCarb / daysTracked) * 10) / 10,
            netCarbs: Math.round((weekNetCarb / daysTracked) * 10) / 10,
            fat: Math.round((weekFat / daysTracked) * 10) / 10,
            daysTracked,
          }
          : { calories: 0, protein: 0, carbs: 0, netCarbs: 0, fat: 0, daysTracked: 0 };

        // Build JSON result
        const result = {
          date: targetDate,
          goals: goalsObj,
          today: { ...todayProgress, mealCount: todayTotals.mealCount },
          streaks: { ...streaks, allGoals: { current: allCurrent, best: allBest } },
          weeklyAvg,
        };

        // Human-readable format
        function bar(percent: number): string {
          const filled = Math.min(Math.round(percent / 10), 10);
          return "■".repeat(filled) + "░".repeat(10 - filled);
        }

        const humanLines = [`Progress for ${targetDate}\n`];
        for (const g of goals) {
          const p = todayProgress[g.key]!;
          const label = g.key.charAt(0).toUpperCase() + g.key.slice(1);
          const remaining = p.remaining >= 0
            ? `${p.remaining} remaining`
            : `OVER by ${Math.abs(p.remaining)}`;
          const zoneStr = p.tolerance > 0 ? ` [${p.zone}]` : "";
          humanLines.push(
            `${label.padEnd(9)} ${String(p.actual).padStart(7)} / ${String(p.goal).padStart(5)}  (${String(p.percent).padStart(3)}%) ${bar(p.percent)} ${remaining}${zoneStr}`
          );
        }

        const streakParts: string[] = [];
        for (const g of goals) {
          const s = streaks[g.key]!;
          const abbr = g.key.slice(0, 3);
          streakParts.push(`${abbr} ${s.current}d (best ${s.best}d)`);
        }
        streakParts.push(`all ${allCurrent}d (best ${allBest}d)`);
        humanLines.push(`\nStreaks:  ${streakParts.join(" | ")}`);
        humanLines.push(
          `\n7-day avg: ${weeklyAvg.calories} cal | ${weeklyAvg.protein}p ${weeklyAvg.carbs}c (${weeklyAvg.netCarbs} net) ${weeklyAvg.fat}f (${weeklyAvg.daysTracked} days tracked)`
        );

        printResult(parseOutput(ProgressPayloadSchema, result), humanLines.join("\n"));
        break;
      }

      case "foods": {
        const subcommand = positional[0];

        if (!subcommand || subcommand === "list") {
          const foods = listCustomFoods();
          printResult(
            parseOutput(FoodsListPayloadSchema, {
              count: foods.length,
              foods: foods.map(formatCustomFoodListItem),
            }),
            foods.length === 0
              ? "No custom foods"
              : foods.map((f, i) =>
                `${i + 1}. ${f.description}${f.brand ? ` (${f.brand})` : ""}` +
                `\n   ${formatNutritionSummary(f)}`
              ).join("\n\n")
          );
          break;
        }

        if (subcommand === "add") {
          const name = positional.slice(1).join(" ");
          if (!name) printError("Usage: nomnom foods add <name> [--calories <n>] ...");

          const id = addCustomFood({
            description: name,
            brand: flags.brand,
            barcode: flags.barcode,
            servingSize: flags.serving,
            calories: parseOptionalFloat(flags.calories),
            protein: parseOptionalFloat(flags.protein),
            carbs: parseOptionalFloat(flags.carbs),
            fat: parseOptionalFloat(flags.fat),
            fiber: parseOptionalFloat(flags.fiber),
            sugar: parseOptionalFloat(flags.sugar),
            sodium: parseOptionalFloat(flags.sodium),
          });

          printResult(
            parseOutput(FoodsAddPayloadSchema, { success: true, id, name }),
            `Added custom food: ${name}`
          );
          break;
        }

        if (subcommand === "delete") {
          const id = positional[1];
          if (!id) printError("Usage: nomnom foods delete <id>");

          const result = deleteCustomFood(id);
          if (!result.deleted) printError(`Custom food not found: ${id}`);

          printResult(
            parseOutput(FoodsDeletePayloadSchema, { success: true, id, name: result.description }),
            `Deleted custom food: ${result.description}`
          );
          break;
        }

        printError(`Unknown foods subcommand "${subcommand}". Use: add, list, delete`);
        break;
      }

      case "recipe":
      case "recipes": {
        const subcommand = positional[0];

        if (!subcommand || subcommand === "list") {
          const recipes = listRecipes();
          printResult(
            parseOutput(RecipeListPayloadSchema, {
              count: recipes.length,
              recipes: recipes.map(formatRecipe),
            }),
            recipes.length === 0
              ? "No saved recipes"
              : recipes.map((recipe, i) =>
                `${i + 1}. [${recipe.id}] ${recipe.name}` +
                `${recipe.servingSize ? ` (${recipe.servingSize})` : ""}` +
                `\n   ${formatNutritionSummary(recipe)}`
              ).join("\n\n")
          );
          break;
        }

        if (subcommand === "create") {
          const name = positional.slice(1).join(" ");
          if (!name) printError("Usage: nomnom recipe create <name> [--calories <n>] ...");

          const recipeInput = {
            name,
            servingSize: flags.serving,
            calories: parseOptionalFloat(flags.calories),
            protein: parseOptionalFloat(flags.protein),
            carbs: parseOptionalFloat(flags.carbs),
            fat: parseOptionalFloat(flags.fat),
            fiber: parseOptionalFloat(flags.fiber),
            sugar: parseOptionalFloat(flags.sugar),
            sodium: parseOptionalFloat(flags.sodium),
          };

          const hasNutrition = [
            recipeInput.calories,
            recipeInput.protein,
            recipeInput.carbs,
            recipeInput.fat,
            recipeInput.fiber,
            recipeInput.sugar,
            recipeInput.sodium,
          ].some((value) => value !== undefined);

          if (!hasNutrition) {
            printError("Recipe templates need at least one nutrition field. Example: nomnom recipe create \"Chicken Bowl\" --calories 500 --protein 30");
          }

          const id = addRecipe(recipeInput);
          const recipe = getRecipeById(id)!;

          printResult(
            parseOutput(RecipeCreatePayloadSchema, { success: true, ...formatRecipe(recipe) }),
            `Saved recipe: ${recipe.name}`
          );
          break;
        }

        if (subcommand === "log") {
          const id = positional[1];
          if (!id) printError("Usage: nomnom recipe log <id> [--multiplier <n>] [--type <meal>] [--notes <text>]");

          const recipe = getRecipeById(id!);
          if (!recipe) printError(`Recipe not found: ${id}`);

          const multiplier = parseOptionalFloat(flags.multiplier) ?? 1;
          if (multiplier <= 0) {
            printError(`Invalid multiplier "${flags.multiplier}". Must be greater than 0.`);
          }

          const mealType = flags.type || "snack";
          if (!VALID_MEAL_TYPES.has(mealType)) {
            printError(`Invalid meal type "${mealType}". Must be one of: breakfast, lunch, dinner, snack`);
          }

          const mealId = logMeal({
            foodName: recipe!.name,
            quantity: multiplier,
            unit: recipe!.servingSize || "recipe",
            mealType,
            notes: flags.notes,
            calories: scaleNutrition(recipe!.calories, multiplier) ?? undefined,
            protein: scaleNutrition(recipe!.protein, multiplier) ?? undefined,
            carbs: scaleNutrition(recipe!.carbs, multiplier) ?? undefined,
            fat: scaleNutrition(recipe!.fat, multiplier) ?? undefined,
            fiber: scaleNutrition(recipe!.fiber, multiplier) ?? undefined,
            sugar: scaleNutrition(recipe!.sugar, multiplier) ?? undefined,
            sodium: scaleNutrition(recipe!.sodium, multiplier) ?? undefined,
          });
          const actualNutrition = {
            calories: scaleNutrition(recipe!.calories, multiplier),
            protein: scaleNutrition(recipe!.protein, multiplier),
            carbs: scaleNutrition(recipe!.carbs, multiplier),
            fat: scaleNutrition(recipe!.fat, multiplier),
            fiber: scaleNutrition(recipe!.fiber, multiplier),
            sugar: scaleNutrition(recipe!.sugar, multiplier),
            sodium: scaleNutrition(recipe!.sodium, multiplier),
            netCarbs: scaleNutrition(recipe!.netCarbs, multiplier),
          };

          const hints = [
            { action: "check-summary", command: "nomnom today", confidence: 0.92 },
            ...(getGoals().length > 0
              ? [{ action: "check-progress", command: "nomnom progress", confidence: 0.84 }]
              : []),
          ];

          printResult(
            parseOutput(RecipeLogPayloadSchema, {
              success: true,
              recipeId: recipe!.id,
              mealId,
              name: recipe!.name,
              multiplier,
              actualNutrition,
              hints,
            }),
            `Logged recipe ${recipe!.name} x${multiplier}`
          );
          break;
        }

        if (subcommand === "delete") {
          const id = positional[1];
          if (!id) printError("Usage: nomnom recipe delete <id>");

          const result = deleteRecipe(id);
          if (!result.deleted) printError(`Recipe not found: ${id}`);

          printResult(
            parseOutput(RecipeDeletePayloadSchema, { success: true, id, name: result.name }),
            `Deleted recipe: ${result.name}`
          );
          break;
        }

        printError(`Unknown recipe subcommand "${subcommand}". Use: create, list, log, delete`);
        break;
      }

      case "trends": {
        const subcommand = positional[0];
        if (subcommand === "apply-suggestion") {
          const id = positional[1];
          if (!id) printError("Usage: nomnom trends apply-suggestion <id> [--days <n>] [--min-occurrences <n>]");

          const days = parsePositiveInt(flags.days, 30, 180);
          const minOccurrences = parsePositiveInt(flags["min-occurrences"], 3, 30);
          const suggestion = getRecipeSuggestions(days, minOccurrences).find((item) => item.id === id);
          if (!suggestion) {
            printError(`Suggestion not found: ${id}`);
          }

          const recipeId = addRecipe({
            name: suggestion!.suggestedName,
            calories: suggestion!.calories ?? undefined,
            protein: suggestion!.protein ?? undefined,
            carbs: suggestion!.carbs ?? undefined,
            fat: suggestion!.fat ?? undefined,
            fiber: suggestion!.fiber ?? undefined,
            sugar: suggestion!.sugar ?? undefined,
            sodium: suggestion!.sodium ?? undefined,
          });
          const recipe = getRecipeById(recipeId)!;

          printResult(
            parseOutput(RecipeApplySuggestionPayloadSchema, {
              success: true,
              suggestionId: suggestion!.id,
              ...formatRecipe(recipe),
              hints: [{
                action: "log-recipe",
                command: `nomnom recipe log ${recipe.id}`,
                confidence: 0.93,
              }],
            }),
            `Saved recipe from suggestion: ${recipe.name}`
          );
          break;
        }

        if (subcommand === "suggest-recipes") {
          const days = parsePositiveInt(flags.days, 30, 180);
          const minOccurrences = parsePositiveInt(flags["min-occurrences"], 3, 30);
          const suggestions = getRecipeSuggestions(days, minOccurrences).map((suggestion): RecipeSuggestionOutput => {
            const nutrition = {
              calories: suggestion.calories,
              protein: suggestion.protein,
              carbs: suggestion.carbs,
              fat: suggestion.fat,
              fiber: suggestion.fiber,
              sugar: suggestion.sugar,
              sodium: suggestion.sodium,
              netCarbs: suggestion.netCarbs,
            };

            return {
              id: suggestion.id,
              foods: suggestion.foods,
              frequency: suggestion.frequency,
              suggestedName: suggestion.suggestedName,
              nutrition,
              hints: [
                {
                  action: "apply-suggestion",
                  command: buildApplySuggestionCommand(suggestion.id, days, minOccurrences),
                  confidence: Math.min(0.99, 0.6 + suggestion.frequency * 0.1),
                },
                {
                  action: "save-as-recipe",
                  command: buildRecipeCreateCommand(suggestion.suggestedName, nutrition),
                  confidence: Math.min(0.99, 0.5 + suggestion.frequency * 0.1),
                },
              ],
            };
          });

          printResult(
            parseOutput(TrendRecipeSuggestionsPayloadSchema, {
              days,
              minOccurrences,
              count: suggestions.length,
              suggestions,
            }),
            suggestions.length === 0
              ? "No repeatable recipe suggestions found"
              : suggestions.map((suggestion, index) =>
                `${index + 1}. ${suggestion.suggestedName} (${suggestion.frequency} days) [${suggestion.id}]` +
                `\n   ${formatNutritionSummary(suggestion.nutrition)}` +
                `\n   ${suggestion.hints[0]?.command ?? ""}`
              ).join("\n\n")
          );
          break;
        }

        const days = parsePositiveInt(flags.days, 7, 90);
        const data = getTrendData(days);

        const humanLines = [
          `Nutrition Trends (${data.period.from} to ${data.period.to})\n`,
          `Averages (${data.daily.length} days with data):`,
          `  Calories: ${data.averages.calories}`,
          `  Protein:  ${data.averages.protein}g`,
          `  Carbs:    ${data.averages.carbs}g`,
          `  Net:      ${data.averages.netCarbs}g`,
          `  Fat:      ${data.averages.fat}g`,
          `\nDaily Breakdown:`,
          ...data.daily.map(
            d => `  ${d.date}: ${d.calories} cal | ${d.protein}p ${d.carbs}c (${d.netCarbs} net) ${d.fat}f (${d.mealCount} meals)`
          ),
        ];

        printResult(parseOutput(TrendsPayloadSchema, data), humanLines.join("\n"));
        break;
      }

      case "mcp":
        printError("MCP server must be started directly: nomnom mcp");

      default:
        printError(`Unknown command: ${command}. Run 'nomnom help' for usage.`);
    }

    return { stdout: stdoutBuf, stderr: stderrBuf, exitCode: 0 };
  } catch (e) {
    if (e instanceof CliError) {
      stderrBuf += JSON.stringify({ error: e.message }) + "\n";
      return { stdout: stdoutBuf, stderr: stderrBuf, exitCode: 1 };
    }
    // Unexpected error
    const message = e instanceof Error ? e.message : "Unknown error";
    stderrBuf += JSON.stringify({ error: message }) + "\n";
    return { stdout: stdoutBuf, stderr: stderrBuf, exitCode: 1 };
  }
}

if (import.meta.main) {
  if (process.argv[2] === "mcp") {
    try {
      await import("./mcp");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start MCP server";
      process.stderr.write(JSON.stringify({ error: msg }) + "\n");
      process.exit(1);
    }
  } else {
    const result = await executeCommand(process.argv.slice(2));
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }
}
