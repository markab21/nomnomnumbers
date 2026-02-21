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
  type FoodResult,
  type CustomFood,
  type MealResult,
  getAllDailyTotals,
  type Goal,
  type DailyTotal,
} from "./db";
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

function parseOptionalFloat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);

function formatFood(food: FoodResult): Record<string, unknown> {
  return {
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
    sugar: food.sugar,
    sodium: food.sodium,
    source: "usda",
  };
}

function formatCustomFood(f: CustomFood): Record<string, unknown> {
  return {
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
    sugar: f.sugar,
    sodium: f.sodium,
    source: "custom",
  };
}

function formatMeal(meal: MealResult): Record<string, unknown> {
  return {
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
  };
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

  today                       Show today's meals and totals
    
  history [options]           Show meal history
    --limit <n>               Max results (default: 20)
    
  goals [options]              View or set daily nutrition goals
    --calories <n>             Daily calorie target
    --protein <n>              Daily protein target (g)
    --carbs <n>                Daily carbs target (g)
    --fat <n>                  Daily fat target (g)
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
            {
              initialized: true,
              dataDir: result.dataDir,
              usdaDownloaded: download.success,
              usdaError: download.error,
            },
            download.success
              ? `Initialized NomNom Numbers!\n\nData directory: ${result.dataDir}\nUSDA database downloaded.`
              : `Initialized NomNom Numbers!\n\nData directory: ${result.dataDir}\nFailed to download USDA database: ${download.error}`
          );
          break;
        }

        const result = initializeDatabase();
        printResult(
          {
            initialized: true,
            dataDir: result.dataDir,
            usdaExists: result.usdaExists
          },
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
            { success: true, dataDir: flags["set-data-dir"] },
            `Data directory set to: ${flags["set-data-dir"]}`
          );
          break;
        }
        if (flags["set-usda-path"]) {
          setUSDAPath(flags["set-usda-path"]);
          printResult(
            { success: true, usdaPath: flags["set-usda-path"] },
            `USDA database path set to: ${flags["set-usda-path"]}`
          );
          break;
        }
        if (flags.reset) {
          resetConfig();
          printResult(
            { success: true },
            "Configuration reset to defaults"
          );
          break;
        }

        const config = loadConfig();
        const paths = getConfigPaths();
        const usdaExists = existsSync(config.usdaDbPath);

        printResult(
          {
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
          },
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
          { query, count: allResults.length, results: allResults },
          allResults.length === 0
            ? `No results for "${query}"`
            : allResults
                .map(
                  (f, i) =>
                    `${i + 1}. [${f.source}] ${f.description}${f.brand ? ` (${f.brand})` : ""}\n` +
                    `   ${f.calories ?? "?"} cal | ${f.protein ?? "?"}p ${f.carbs ?? "?"}c ${f.fat ?? "?"}f`
                )
                .join("\n\n")
        );
        break;
      }

      case "lookup": {
        const barcode = positional[0];
        if (!barcode) printError("Usage: nomnom lookup <barcode>");
        const usda = await ensureUSDA();
        if (!usda.ready) {
          printError(usda.error || "USDA database not available");
        }
        const food = lookupBarcode(barcode!);
        if (!food) {
          printResult({ found: false, barcode }, `Barcode ${barcode} not found`);
        } else {
          printResult(
            { found: true, ...formatFood(food) },
            `${food.description}${food.brand ? ` (${food.brand})` : ""}\n` +
              `${food.calories ?? "?"} cal | ${food.protein ?? "?"}p ${food.carbs ?? "?"}c ${food.fat ?? "?"}f`
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
          { success: true, id, foodName: meal!.foodName },
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

        if (updated.length === 0) {
          printResult(
            { success: true, id, foodName: merged.foodName, updated: [] },
            `No changes to ${merged.foodName}`
          );
          break;
        }

        updateMeal(id!, merged);

        printResult(
          { success: true, id, foodName: merged.foodName, updated },
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
        });

        printResult(
          { success: true, id, foodName, quantity },
          `Logged ${quantity} ${flags.unit || "serving"} of ${foodName}`
        );
        break;
      }

      case "today": {
        const offsetDays = parseInt(flags.date ?? "0", 10);
        const today = computeDateStr(isNaN(offsetDays) ? 0 : offsetDays);
        const meals = getMealsByDate(today);
        const totals = getDailyTotals(today);

        printResult(
          { date: today, totals, meals: meals.map(formatMeal) },
          `Today's Summary (${today})\n` +
            `${totals.mealCount} meals | ${totals.calories} cal | ${totals.protein}p ${totals.carbs}c ${totals.fat}f\n\n` +
            (meals.length === 0
              ? "No meals logged"
              : meals
                  .map(
                    (m) =>
                      `- ${m.foodName} (${m.quantity} ${m.unit}) [${m.mealType}]\n` +
                        `  ${m.calories ?? "?"} cal | ${m.protein ?? "?"}p ${m.carbs ?? "?"}c ${m.fat ?? "?"}f${m.notes ? ` | ${m.notes}` : ""} | ${m.loggedAt}`
                  )
                  .join("\n"))
        );
        break;
      }

      case "history": {
        const limit = parsePositiveInt(flags.limit, 20, 500);
        const meals = getMealHistory(limit);
        printResult(
          { count: meals.length, meals: meals.map(formatMeal) },
          meals.length === 0
            ? "No meals in history"
            : meals
                .map(
                  (m) =>
                    `${m.loggedAt} - ${m.foodName} (${m.quantity} ${m.unit})\n` +
                      `  ${m.calories ?? "?"} cal | ${m.protein ?? "?"}p ${m.carbs ?? "?"}c ${m.fat ?? "?"}f`
                )
                .join("\n\n")
        );
        break;
      }

      case "goals": {
        // Reset
        if (flags.reset) {
          resetGoals();
          printResult({ success: true }, "Goals reset");
          break;
        }

        // Set goals (at least one macro flag required)
        const macros = ["calories", "protein", "carbs", "fat"] as const;
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
            { success: true, goalsSet: allKeys },
            `Goals set: ${allKeys.join(", ")}`
          );
          break;
        }

        // View goals
        const goals = getGoals();
        if (goals.length === 0) {
          printResult({ goals: null }, "No goals set. Use: nomnom goals --calories 2000 --protein 120");
          break;
        }

        const goalsObj: Record<string, { target: number; direction: string; tolerance: number }> = {};
        let latestUpdate = "";
        for (const g of goals) {
          goalsObj[g.key] = { target: g.target, direction: g.direction, tolerance: g.tolerance };
          if (g.updatedAt > latestUpdate) latestUpdate = g.updatedAt;
        }

        printResult(
          { goals: { ...goalsObj, updatedAt: latestUpdate } },
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
        let weekCal = 0, weekPro = 0, weekCarb = 0, weekFat = 0, daysTracked = 0;
        for (const wd of weekDates) {
          const day = dayMap.get(wd);
          if (day && day.mealCount > 0) {
            weekCal += day.calories;
            weekPro += day.protein;
            weekCarb += day.carbs;
            weekFat += day.fat;
            daysTracked++;
          }
        }

        const weeklyAvg = daysTracked > 0
          ? {
              calories: Math.round((weekCal / daysTracked) * 10) / 10,
              protein: Math.round((weekPro / daysTracked) * 10) / 10,
              carbs: Math.round((weekCarb / daysTracked) * 10) / 10,
              fat: Math.round((weekFat / daysTracked) * 10) / 10,
              daysTracked,
            }
          : { calories: 0, protein: 0, carbs: 0, fat: 0, daysTracked: 0 };

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
          `\n7-day avg: ${weeklyAvg.calories} cal | ${weeklyAvg.protein}p ${weeklyAvg.carbs}c ${weeklyAvg.fat}f (${weeklyAvg.daysTracked} days tracked)`
        );

        printResult(result, humanLines.join("\n"));
        break;
      }

      case "foods": {
        const subcommand = positional[0];

        if (!subcommand || subcommand === "list") {
          const foods = listCustomFoods();
          printResult(
            { count: foods.length, foods: foods.map(f => ({
              id: f.id, name: f.description, brand: f.brand, barcode: f.barcode,
              servingSize: f.servingSize, calories: f.calories, protein: f.protein,
              carbs: f.carbs, fat: f.fat, fiber: f.fiber, sugar: f.sugar,
              sodium: f.sodium, createdAt: f.createdAt,
            })) },
            foods.length === 0
              ? "No custom foods"
              : foods.map((f, i) =>
                  `${i + 1}. ${f.description}${f.brand ? ` (${f.brand})` : ""}` +
                  `\n   ${f.calories ?? "?"} cal | ${f.protein ?? "?"}p ${f.carbs ?? "?"}c ${f.fat ?? "?"}f`
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
            { success: true, id, name },
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
            { success: true, id, name: result.description },
            `Deleted custom food: ${result.description}`
          );
          break;
        }

        printError(`Unknown foods subcommand "${subcommand}". Use: add, list, delete`);
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
