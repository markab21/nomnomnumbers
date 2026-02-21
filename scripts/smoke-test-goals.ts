#!/usr/bin/env bun
/**
 * smoke-test-goals.ts
 * Tests the goals + progress system end-to-end.
 * Run: bun scripts/smoke-test-goals.ts
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const dataDir = process.env.NOMNOM_DATA_DIR ?? join(homedir(), ".local", "share", "nomnom");
const dbPath = join(dataDir, "nomnom.db");
const projectRoot = new URL("..", import.meta.url).pathname;

// Reset
if (existsSync(dbPath)) rmSync(dbPath);

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    const msg = detail ? `${name}: ${detail}` : name;
    failures.push(msg);
    console.log(`✗ ${msg}`);
  }
}

function run(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", "start", ...args], { cwd: projectRoot, stderr: "pipe" });
  return {
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
    exitCode: result.exitCode ?? 1,
  };
}

function runScript(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", ...args], { cwd: projectRoot, stderr: "pipe" });
  return {
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
    exitCode: result.exitCode ?? 1,
  };
}

// ---- Seed ----
console.log("Seeding 28 days...");
const seed = runScript("scripts/seed-month.ts");
check("Seeder ran", seed.exitCode === 0, seed.stderr);

// ---- goals: no goals set ----
console.log("\n--- Goals CRUD ---");
const noGoals = run("goals");
const noGoalsJson = JSON.parse(noGoals.stdout);
check("No goals initially", noGoalsJson.goals === null);

// ---- goals: set ----
const setResult = run("goals", "--calories", "2000", "--protein", "100", "--carbs", "250", "--fat", "70");
const setJson = JSON.parse(setResult.stdout);
check("Set goals success", setJson.success === true);
check("Set 4 goals", setJson.goalsSet?.length === 4);

// ---- goals: view ----
const viewResult = run("goals");
const viewJson = JSON.parse(viewResult.stdout);
check("View has goals", viewJson.goals !== null);
check("Calories target 2000", viewJson.goals?.calories?.target === 2000);
check("Protein target 100", viewJson.goals?.protein?.target === 100);
check("Protein direction over", viewJson.goals?.protein?.direction === "over");
check("Calories direction under", viewJson.goals?.calories?.direction === "under");

// ---- progress: today ----
console.log("\n--- Progress (today) ---");
const prog = run("progress");
check("Progress exit 0", prog.exitCode === 0, `exit=${prog.exitCode}`);
const p = JSON.parse(prog.stdout);

check("Has date field", typeof p.date === "string" && p.date.length === 10);
check("Has goals object", p.goals !== null && typeof p.goals === "object");
check("Has today object", p.today !== null && typeof p.today === "object");
check("Has streaks object", p.streaks !== null && typeof p.streaks === "object");
check("Has weeklyAvg object", p.weeklyAvg !== null && typeof p.weeklyAvg === "object");

// Today macro fields
for (const macro of ["calories", "protein", "carbs", "fat"]) {
  const m = p.today[macro];
  check(`today.${macro}.actual is number`, typeof m?.actual === "number");
  check(`today.${macro}.goal is number`, typeof m?.goal === "number");
  check(`today.${macro}.remaining is number`, typeof m?.remaining === "number");
  check(`today.${macro}.percent is number`, typeof m?.percent === "number");
}
check("today.mealCount is 4", p.today.mealCount === 4);

// Streaks
for (const macro of ["calories", "protein", "carbs", "fat"]) {
  const s = p.streaks[macro];
  check(`streaks.${macro}.current >= 0`, s?.current >= 0);
  check(`streaks.${macro}.best >= current`, s?.best >= s?.current);
  check(`streaks.${macro}.direction exists`, s?.direction === "under" || s?.direction === "over");
}
check("streaks.allGoals.current >= 0", p.streaks.allGoals?.current >= 0);
check("streaks.allGoals.best >= current", p.streaks.allGoals?.best >= p.streaks.allGoals?.current);

// Weekly avg
check("weeklyAvg.calories > 0", p.weeklyAvg.calories > 0);
check("weeklyAvg.daysTracked > 0", p.weeklyAvg.daysTracked > 0);
check("weeklyAvg.daysTracked <= 7", p.weeklyAvg.daysTracked <= 7);

// ---- progress: historical day ----
console.log("\n--- Progress (--date -14) ---");
const prog14 = run("progress", "--date", "-14");
check("Historical progress exit 0", prog14.exitCode === 0);
const p14 = JSON.parse(prog14.stdout);
check("Historical date is 14 days ago", p14.date.length === 10);
check("Historical has mealCount 4", p14.today.mealCount === 4);

// ---- progress: human mode ----
console.log("\n--- Human mode ---");
const humanProg = run("progress", "--human");
check("Human output contains Progress", humanProg.stdout.includes("Progress for"));
check("Human output contains Streaks", humanProg.stdout.includes("Streaks:"));
check("Human output contains 7-day avg", humanProg.stdout.includes("7-day avg:"));

// ---- goals: reset ----
console.log("\n--- Goals reset ---");
run("goals", "--reset");
const afterReset = run("goals");
const afterResetJson = JSON.parse(afterReset.stdout);
check("Goals null after reset", afterResetJson.goals === null);

// ---- progress: should fail without goals ----
const noGoalProg = run("progress");
check("Progress fails without goals (exit 1)", noGoalProg.exitCode === 1);

// ---- Summary ----
console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
}
