#!/usr/bin/env bun
/**
 * smoke-test-month.ts
 * Seeds 28 days of meal history and validates every day via the CLI.
 * Run: bun scripts/smoke-test-month.ts
 * Exit code: 0 = all pass, 1 = any failure
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---- Resolve DB path ----
const dataDir = process.env.NOMNOM_DATA_DIR ?? join(homedir(), ".local", "share", "nomnom");
const dbPath = join(dataDir, "nomnom.db");
const projectRoot = new URL("..", import.meta.url).pathname;

// ---- Reset DB ----
for (const suffix of ["", "-wal", "-shm"]) {
  const p = dbPath + suffix;
  if (existsSync(p)) {
    rmSync(p);
    if (suffix === "") console.log(`Reset DB: ${dbPath}`);
  }
}

// ---- Run seeder ----
console.log("Seeding 28 days of meal history...");
const seedResult = Bun.spawnSync(["bun", "scripts/seed-month.ts"], {
  cwd: projectRoot,
  stderr: "pipe",
});
const seedOut = new TextDecoder().decode(seedResult.stdout).trim();
const seedErr = new TextDecoder().decode(seedResult.stderr).trim();
if (seedResult.exitCode !== 0) {
  console.error("Seeder failed:", seedErr);
  process.exit(1);
}
console.log(seedOut);
console.log("");

// ---- Helpers ----
function dateForOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Meal {
  foodName: string;
  mealType: string;
  calories: number | null;
}

interface DayResult {
  date: string;
  totals: { calories: number; protein: number; carbs: number; fat: number; mealCount: number };
  meals: Meal[];
}

function queryDay(offset: number): DayResult | null {
  const result = Bun.spawnSync(
    ["bun", "start", "today", "--date", String(offset)],
    { cwd: projectRoot, stderr: "pipe" }
  );
  const raw = new TextDecoder().decode(result.stdout).trim();
  try {
    return JSON.parse(raw) as DayResult;
  } catch {
    return null;
  }
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

// ---- Validate all 28 days ----
for (let offset = -27; offset <= 0; offset++) {
  const expectedDate = dateForOffset(offset);
  const day = queryDay(offset);

  if (!day) {
    failures.push(`day ${offset}: could not parse JSON`);
    failed++;
    console.log(`✗ day ${String(offset).padStart(3)} (${expectedDate})  FAIL: JSON parse error`);
    continue;
  }

  const errors: string[] = [];

  if (day.date !== expectedDate) {
    errors.push(`date="${day.date}" expected="${expectedDate}"`);
  }
  if (day.totals.mealCount !== 4) {
    errors.push(`mealCount=${day.totals.mealCount} expected=4`);
  }
  if (day.meals.length !== 4) {
    errors.push(`meals.length=${day.meals.length} expected=4`);
  }
  if (day.totals.calories <= 0) {
    errors.push(`calories=${day.totals.calories} expected>0`);
  }

  const types = new Set(day.meals.map((m) => m.mealType));
  for (const t of ["breakfast", "lunch", "dinner", "snack"]) {
    if (!types.has(t)) errors.push(`missing mealType="${t}"`);
  }

  for (const m of day.meals) {
    if (m.calories === null || m.calories === undefined) {
      errors.push(`meal "${m.foodName}" has null calories`);
    }
  }

  if (errors.length === 0) {
    passed++;
    console.log(`✓ day ${String(offset).padStart(3)} (${expectedDate})  ${day.totals.mealCount} meals  ${day.totals.calories} cal`);
  } else {
    failed++;
    const detail = errors.join("; ");
    failures.push(`day ${offset} (${expectedDate}): ${detail}`);
    console.log(`✗ day ${String(offset).padStart(3)} (${expectedDate})  FAIL: ${detail}`);
  }
}

// ---- Cross-week calorie check ----
console.log("");
console.log("Cross-week calorie check...");

function weekAvgCalories(startOffset: number): number {
  let total = 0;
  for (let o = startOffset; o < startOffset + 7; o++) {
    const day = queryDay(o);
    total += day?.totals.calories ?? 0;
  }
  return total / 7;
}

const week0Avg = weekAvgCalories(-27);
const week3Avg = weekAvgCalories(-6);

console.log(`Week 0 (days -27..-21) avg calories: ${week0Avg.toFixed(1)}`);
console.log(`Week 3 (days  -6.. 0) avg calories: ${week3Avg.toFixed(1)}`);

if (week0Avg > week3Avg) {
  console.log("✓ week 0 avg > week 3 avg  (factor 1.0 > 0.95 confirmed)");
  passed++;
} else {
  console.log(`✗ FAIL: week 0 avg (${week0Avg.toFixed(1)}) should be > week 3 avg (${week3Avg.toFixed(1)})`);
  failures.push(`cross-week: week0avg=${week0Avg.toFixed(1)} <= week3avg=${week3Avg.toFixed(1)}`);
  failed++;
}

// ---- Summary ----
console.log("");
console.log("=".repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
}
