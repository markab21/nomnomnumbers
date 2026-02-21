#!/usr/bin/env bun
/**
 * smoke-test-tolerance.ts
 * Tests the tolerance band system end-to-end.
 * Run: bun scripts/smoke-test-tolerance.ts
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const dataDir = process.env.NOMNOM_DATA_DIR ?? join(homedir(), ".local", "share", "nomnom");
const dbPath = join(dataDir, "nomnom.db");
const projectRoot = new URL("..", import.meta.url).pathname;

if (existsSync(dbPath)) rmSync(dbPath);
if (existsSync(dbPath + "-wal")) rmSync(dbPath + "-wal");
if (existsSync(dbPath + "-shm")) rmSync(dbPath + "-shm");

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

function resetDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

// ============================================================
// Test 1: Backward compatibility (tolerance = 0)
// ============================================================
console.log("\n--- Test 1: Backward compatibility (tolerance = 0) ---");
resetDb();

run("log", "Chicken Bowl", "--calories", "1800", "--protein", "130", "--carbs", "200", "--fat", "50");
run("goals", "--calories", "2000", "--protein", "120");

const prog1 = run("progress");
check("Test 1: progress exits 0", prog1.exitCode === 0, `exit=${prog1.exitCode}`);
const p1 = JSON.parse(prog1.stdout);

check("Test 1: calories zone = met", p1.today.calories.zone === "met", `got ${p1.today.calories.zone}`);
check("Test 1: calories band = target (2000)", p1.today.calories.band === 2000, `got ${p1.today.calories.band}`);
check("Test 1: calories tolerance = 0", p1.today.calories.tolerance === 0, `got ${p1.today.calories.tolerance}`);

check("Test 1: protein zone = met", p1.today.protein.zone === "met", `got ${p1.today.protein.zone}`);
check("Test 1: protein band = target (120)", p1.today.protein.band === 120, `got ${p1.today.protein.band}`);
check("Test 1: protein tolerance = 0", p1.today.protein.tolerance === 0, `got ${p1.today.protein.tolerance}`);

// ============================================================
// Test 2: Zone = near (within grace zone)
// ============================================================
console.log("\n--- Test 2: Zone = near (within grace zone) ---");
resetDb();

run("log", "Big Meal", "--calories", "2100", "--protein", "115", "--carbs", "260", "--fat", "75");
run("goals",
  "--calories", "2000", "--calories-tolerance", "10",
  "--protein", "120", "--protein-tolerance", "15",
  "--carbs", "250", "--carbs-tolerance", "5",
  "--fat", "70", "--fat-tolerance", "0");

const prog2 = run("progress");
check("Test 2: progress exits 0", prog2.exitCode === 0, `exit=${prog2.exitCode}`);
const p2 = JSON.parse(prog2.stdout);

// calories: actual=2100 > 2000, but <= 2200 (2000*1.10) → near, band=2200
check("Test 2: calories zone = near", p2.today.calories.zone === "near", `got ${p2.today.calories.zone}`);
check("Test 2: calories band = 2200", p2.today.calories.band === 2200, `got ${p2.today.calories.band}`);

// protein: actual=115 < 120, but >= 102 (120*0.85) → near, band=102
check("Test 2: protein zone = near", p2.today.protein.zone === "near", `got ${p2.today.protein.zone}`);
check("Test 2: protein band = 102", p2.today.protein.band === 102, `got ${p2.today.protein.band}`);

// carbs: actual=260 > 250, but <= 262.5 (250*1.05) → near, band=262.5
check("Test 2: carbs zone = near", p2.today.carbs.zone === "near", `got ${p2.today.carbs.zone}`);
check("Test 2: carbs band = 262.5", p2.today.carbs.band === 262.5, `got ${p2.today.carbs.band}`);

// fat: actual=75 > 70, tol=0% so band=70, 75 > 70 → over, band=70
check("Test 2: fat zone = over", p2.today.fat.zone === "over", `got ${p2.today.fat.zone}`);
check("Test 2: fat band = 70", p2.today.fat.band === 70, `got ${p2.today.fat.band}`);

// ============================================================
// Test 3: Zone = missed (outside band)
// ============================================================
console.log("\n--- Test 3: Zone = missed (outside band) ---");
resetDb();

run("log", "Huge Meal", "--calories", "2300", "--protein", "90");
run("goals",
  "--calories", "2000", "--calories-tolerance", "10",
  "--protein", "120", "--protein-tolerance", "15");

const prog3 = run("progress");
check("Test 3: progress exits 0", prog3.exitCode === 0, `exit=${prog3.exitCode}`);
const p3 = JSON.parse(prog3.stdout);

// calories: 2300 > 2200 → over
check("Test 3: calories zone = over", p3.today.calories.zone === "over", `got ${p3.today.calories.zone}`);

// protein: 90 < 102 → under
check("Test 3: protein zone = under", p3.today.protein.zone === "under", `got ${p3.today.protein.zone}`);

// ============================================================
// Test 4: Zone = met (on correct side with tolerance set)
// ============================================================
console.log("\n--- Test 4: Zone = met (on correct side) ---");
resetDb();

run("log", "Good Meal", "--calories", "1800", "--protein", "140");
run("goals",
  "--calories", "2000", "--calories-tolerance", "10",
  "--protein", "120", "--protein-tolerance", "15");

const prog4 = run("progress");
check("Test 4: progress exits 0", prog4.exitCode === 0, `exit=${prog4.exitCode}`);
const p4 = JSON.parse(prog4.stdout);

// calories: 1800 <= 2000 → met
check("Test 4: calories zone = met", p4.today.calories.zone === "met", `got ${p4.today.calories.zone}`);
// protein: 140 >= 120 → met
check("Test 4: protein zone = met", p4.today.protein.zone === "met", `got ${p4.today.protein.zone}`);

// ============================================================
// Test 5: Streaks use zone logic
// ============================================================
console.log("\n--- Test 5: Streaks use zone logic ---");
resetDb();

// Seed 28 days of data
console.log("Seeding 28 days...");
const seed = runScript("scripts/seed-month.ts");
check("Test 5: Seeder ran", seed.exitCode === 0, seed.stderr);

// Set calorie goal=1600, tolerance=20% → band=1920
// All seeded days have cal <= 1833.4 < 1920 → all met or near
run("goals", "--calories", "1600", "--calories-tolerance", "20");

const prog5a = run("progress");
check("Test 5: progress with tol exits 0", prog5a.exitCode === 0, `exit=${prog5a.exitCode}`);
const p5a = JSON.parse(prog5a.stdout);
const streakWithTol = p5a.streaks.calories.current;

check("Test 5: streak with tol >= 28", streakWithTol >= 28, `got ${streakWithTol}`);

// Now set tolerance=0 → days over 1600 break streak
run("goals", "--calories", "1600", "--calories-tolerance", "0");

const prog5b = run("progress");
check("Test 5: progress without tol exits 0", prog5b.exitCode === 0, `exit=${prog5b.exitCode}`);
const p5b = JSON.parse(prog5b.stdout);
const streakWithoutTol = p5b.streaks.calories.current;

check("Test 5: streak_with_tol > streak_without_tol",
  streakWithTol > streakWithoutTol,
  `with=${streakWithTol}, without=${streakWithoutTol}`);

// ============================================================
// Test 6: Goals view includes tolerance
// ============================================================
console.log("\n--- Test 6: Goals view includes tolerance ---");
resetDb();

run("goals", "--calories", "2000", "--calories-tolerance", "10", "--protein", "120");

const goalsView = run("goals");
check("Test 6: goals exits 0", goalsView.exitCode === 0, `exit=${goalsView.exitCode}`);
const g6 = JSON.parse(goalsView.stdout);

check("Test 6: calories.tolerance = 10", g6.goals.calories.tolerance === 10, `got ${g6.goals?.calories?.tolerance}`);
check("Test 6: protein.tolerance = 0", g6.goals.protein.tolerance === 0, `got ${g6.goals?.protein?.tolerance}`);

// ============================================================
// Test 7: Tolerance-only update
// ============================================================
console.log("\n--- Test 7: Tolerance-only update ---");
// Goals from Test 6 still active (calories=2000/tol=10, protein=120/tol=0)

const tolUpdate = run("goals", "--protein-tolerance", "20");
check("Test 7: tolerance-only update exits 0", tolUpdate.exitCode === 0, `exit=${tolUpdate.exitCode}`);
const t7 = JSON.parse(tolUpdate.stdout);
check("Test 7: success = true", t7.success === true);

const goalsAfter = run("goals");
const g7 = JSON.parse(goalsAfter.stdout);
check("Test 7: protein.tolerance = 20", g7.goals.protein.tolerance === 20, `got ${g7.goals?.protein?.tolerance}`);
check("Test 7: protein.target unchanged = 120", g7.goals.protein.target === 120, `got ${g7.goals?.protein?.target}`);

// ============================================================
// Test 8: Tolerance-only without existing goal fails
// ============================================================
console.log("\n--- Test 8: Tolerance-only without existing goal fails ---");
// No fat goal exists from Test 6 setup

const tolNoGoal = run("goals", "--fat-tolerance", "10");
check("Test 8: exits 1", tolNoGoal.exitCode === 1, `exit=${tolNoGoal.exitCode}`);

// ============================================================
// Test 9: Progress always has new fields
// ============================================================
console.log("\n--- Test 9: Progress always has new fields ---");
resetDb();

run("log", "Snack", "--calories", "500", "--protein", "20", "--carbs", "50", "--fat", "10");
run("goals", "--calories", "2000", "--protein", "120", "--carbs", "250", "--fat", "70");

const prog9 = run("progress");
check("Test 9: progress exits 0", prog9.exitCode === 0, `exit=${prog9.exitCode}`);
const p9 = JSON.parse(prog9.stdout);

for (const macro of ["calories", "protein", "carbs", "fat"]) {
  const m = p9.today[macro];
  check(`Test 9: ${macro} has tolerance field`, typeof m?.tolerance === "number", `got ${typeof m?.tolerance}`);
  check(`Test 9: ${macro} has band field`, typeof m?.band === "number", `got ${typeof m?.band}`);
  check(`Test 9: ${macro} has zone field`, typeof m?.zone === "string", `got ${typeof m?.zone}`);
}

// ============================================================
// Test 10: Human mode shows zone tag
// ============================================================
console.log("\n--- Test 10: Human mode shows zone tag ---");
resetDb();

run("log", "Over Meal", "--calories", "2100");
run("goals", "--calories", "2000", "--calories-tolerance", "10");

const humanProg = run("progress", "--human");
check("Test 10: progress exits 0", humanProg.exitCode === 0, `exit=${humanProg.exitCode}`);
check("Test 10: human output contains [near]",
  humanProg.stdout.includes("[near]"),
  `output: ${humanProg.stdout.slice(0, 300)}`);

// ============================================================
// Test 11: Tolerance validation (reject out-of-range values)
// ============================================================
console.log("\n--- Test 11: Tolerance validation (reject out-of-range) ---");
resetDb();

// Negative tolerance → error
const negTol = run("goals", "--calories", "2000", "--calories-tolerance", "-5");
check("Test 11a: negative tolerance exits 1", negTol.exitCode === 1, `exit=${negTol.exitCode}`);
check("Test 11a: stderr has error",
  negTol.stderr.includes("must be 0-100"),
  `stderr: ${negTol.stderr.slice(0, 200)}`);

// Tolerance > 100 → error
const bigTol = run("goals", "--calories", "2000", "--calories-tolerance", "150");
check("Test 11b: tolerance > 100 exits 1", bigTol.exitCode === 1, `exit=${bigTol.exitCode}`);
check("Test 11b: stderr has error",
  bigTol.stderr.includes("must be 0-100"),
  `stderr: ${bigTol.stderr.slice(0, 200)}`);

// Edge: tolerance = 0 → accepted
const zeroTol = run("goals", "--calories", "2000", "--calories-tolerance", "0");
check("Test 11c: tolerance 0 exits 0", zeroTol.exitCode === 0, `exit=${zeroTol.exitCode}`);

// Edge: tolerance = 100 → accepted
const maxTol = run("goals", "--calories-tolerance", "100");
check("Test 11d: tolerance 100 exits 0", maxTol.exitCode === 0, `exit=${maxTol.exitCode}`);

// Verify the stored values
const g11 = JSON.parse(run("goals").stdout);
check("Test 11e: tolerance stored as 100", g11.goals.calories.tolerance === 100, `got ${g11.goals?.calories?.tolerance}`);

// Tolerance-only negative → error (no target, just tolerance flag)
const tolOnlyNeg = run("goals", "--protein-tolerance", "-10");
check("Test 11f: tolerance-only negative exits 1", tolOnlyNeg.exitCode === 1, `exit=${tolOnlyNeg.exitCode}`);

// ============================================================
// Summary
// ============================================================
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
