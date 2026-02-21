#!/usr/bin/env bun
import {
  searchFoods,
  lookupBarcode,
  logMeal,
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
  type FoodResult,
  type MealResult,
} from "./db";
import { existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
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

function printResult(data: unknown, human?: string) {
  const { flags } = parseFlags(args);
  if (flags.human || flags.h) {
    console.log(human || JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function printError(message: string) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

async function ensureUSDA(autoDownload: boolean = true): Promise<{ ready: boolean; error?: string }> {
  if (isUSDBAvailable()) {
    return { ready: true };
  }
  
  if (!autoDownload) {
    return { ready: false, error: getUSDAHelp() };
  }
  
  console.error("USDA database not found. Downloading...");
  
  const result = await downloadUSDADatabase((progress) => {
    if (progress.status === "downloading" && progress.percent !== undefined) {
      console.error(`  ${progress.message} ${progress.percent}%`);
    } else {
      console.error(`  ${progress.message}`);
    }
  });
  
  if (result.success) {
    console.error("USDA database downloaded successfully!\n");
    return { ready: true };
  }
  
  return { ready: false, error: `Failed to download USDA database: ${result.error}` };
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

function showHelp() {
  console.log(`
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
    
  today                       Show today's meals and totals
    
  history [options]           Show meal history
    --limit <n>               Max results (default: 20)
    
  config [options]            View or set configuration
    --set-data-dir <path>     Set data directory
    --set-usda-path <path>    Set USDA database path
    --reset                   Reset to defaults
    
  help                        Show this help

Environment Variables:
  NOMNOM_DATA_DIR    Override data directory
  NOMNOM_CONFIG_DIR  Override config directory

Output is JSON by default. Add --human or -h for readable format.
`);
}

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  const { flags, positional } = parseFlags(args.slice(1));

  switch (command) {
    case "init": {
      if (flags["download-usda"]) {
        const result = initializeDatabase();
        const download = await downloadUSDADatabase((progress) => {
          if (progress.status === "downloading" && progress.percent !== undefined) {
            console.error(`  ${progress.message} ${progress.percent}%`);
          } else {
            console.error(`  ${progress.message}`);
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
      const usda = await ensureUSDA();
      if (!usda.ready) {
        printError(usda.error || "USDA database not available");
      }
      const query = positional.join(" ");
      if (!query) printError("Usage: nomnom search <query>");
      const limit = parseInt(flags.limit || "10", 10);
      const results = searchFoods(query, limit);
      printResult(
        { query, count: results.length, results: results.map(formatFood) },
        results.length === 0
          ? `No results for "${query}"`
          : results
              .map(
                (f, i) =>
                  `${i + 1}. ${f.description}${f.brand ? ` (${f.brand})` : ""}\n` +
                  `   ${f.calories || "?"} cal | ${f.protein || "?"}p ${f.carbs || "?"}c ${f.fat || "?"}f`
              )
              .join("\n\n")
      );
      break;
    }

    case "lookup": {
      const usda = await ensureUSDA();
      if (!usda.ready) {
        printError(usda.error || "USDA database not available");
      }
      const barcode = positional[0];
      if (!barcode) printError("Usage: nomnom lookup <barcode>");
      const food = lookupBarcode(barcode!);
      if (!food) {
        printResult({ found: false, barcode }, `Barcode ${barcode} not found`);
      } else {
        printResult(
          { found: true, ...formatFood(food) },
          `${food.description}${food.brand ? ` (${food.brand})` : ""}\n` +
            `${food.calories || "?"} cal | ${food.protein || "?"}p ${food.carbs || "?"}c ${food.fat || "?"}f`
        );
      }
      break;
    }

    case "log": {
      const foodName = positional.join(" ");
      if (!foodName) printError("Usage: nomnom log <food> [--qty <n>] [--calories <n>] ...");

      const id = logMeal({
        foodName,
        quantity: parseFloat(flags.qty || "1"),
        unit: flags.unit || "serving",
        mealType: flags.type || "snack",
        notes: flags.notes,
        calories: flags.calories ? parseFloat(flags.calories) : undefined,
        protein: flags.protein ? parseFloat(flags.protein) : undefined,
        carbs: flags.carbs ? parseFloat(flags.carbs) : undefined,
        fat: flags.fat ? parseFloat(flags.fat) : undefined,
      });

      printResult(
        { success: true, id, foodName, quantity: flags.qty || 1 },
        `Logged ${flags.qty || 1} ${flags.unit || "serving"} of ${foodName}`
      );
      break;
    }

    case "today": {
      const today = new Date().toISOString().split("T")[0];
      const meals = getMealsByDate(today!);
      const totals = getDailyTotals(today!);

      printResult(
        { date: today, totals, meals: meals.map(formatMeal) },
        `Today's Summary (${today})\n` +
          `${totals.mealCount} meals | ${totals.calories} cal | ${totals.protein}p ${totals.carbs}c ${totals.fat}f\n\n` +
          (meals.length === 0
            ? "No meals logged"
            : meals
                .map(
                  (m) =>
                    `- ${m.foodName} (${m.quantity} ${m.unit})\n` +
                      `  ${m.calories || "?"} cal | ${m.protein || "?"}p | ${m.loggedAt}`
                )
                .join("\n"))
      );
      break;
    }

    case "history": {
      const limit = parseInt(flags.limit || "20", 10);
      const meals = getMealHistory(limit);
      printResult(
        { count: meals.length, meals: meals.map(formatMeal) },
        meals.length === 0
          ? "No meals in history"
          : meals
              .map(
                (m) =>
                  `${m.loggedAt} - ${m.foodName} (${m.quantity} ${m.unit})\n` +
                    `  ${m.calories || "?"} cal | ${m.protein || "?"}p ${m.carbs || "?"}c ${m.fat || "?"}f`
              )
              .join("\n\n")
      );
      break;
    }

    default:
      printError(`Unknown command: ${command}. Run 'nomnom help' for usage.`);
  }
}

main().catch((err) => {
  printError(err instanceof Error ? err.message : "Unknown error");
});
