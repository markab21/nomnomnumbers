# Tolerance Band Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tolerance percentage to each goal that creates a grace zone, turning binary pass/fail into zone-based tracking (met/near/missed) while preserving full backward compatibility at tolerance 0.

**Architecture:** One new column (`tolerance REAL NOT NULL DEFAULT 0`) in the `goals` table. Zone computation is a pure function applied at query time. Streaks use zone logic (met + near sustain, only over/under breaks). No new tables, no new commands — extends existing `goals` and `progress` commands.

**Tech Stack:** Bun, SQLite (bun:sqlite), TypeScript (strict mode)

---

### Task 1: Schema Migration + Goal Interface Update

**Files:**
- Modify: `src/db.ts:271-301` (initTables — add `tolerance` column to CREATE TABLE)
- Modify: `src/db.ts:584-588` (Goal interface — add `tolerance: number`)
- Modify: `src/db.ts:599-608` (setGoal — accept and persist tolerance)
- Modify: `src/db.ts:610-621` (getGoals — read tolerance column)

**Step 1: Update the `Goal` interface**

In `src/db.ts`, change the `Goal` interface (around line 584) to add `tolerance`:

```typescript
export interface Goal {
  key: string;
  target: number;
  direction: "under" | "over";
  tolerance: number;
  updatedAt: string;
}
```

**Step 2: Update `initTables` to include tolerance in CREATE TABLE**

In `src/db.ts`, the `CREATE TABLE IF NOT EXISTS goals` statement (around line 295) should become:

```sql
CREATE TABLE IF NOT EXISTS goals (
  key TEXT PRIMARY KEY,
  target REAL NOT NULL,
  direction TEXT NOT NULL DEFAULT 'under',
  tolerance REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 3: Add migration for existing databases**

Right after the `CREATE TABLE IF NOT EXISTS goals` block, add a migration that adds the column if it doesn't exist. SQLite doesn't have `ADD COLUMN IF NOT EXISTS`, so use a try/catch:

```typescript
// Migration: add tolerance column if missing (existing databases)
try {
  db.exec("ALTER TABLE goals ADD COLUMN tolerance REAL NOT NULL DEFAULT 0");
} catch {
  // Column already exists — ignore
}
```

Add this inside `initTables`, after the CREATE TABLE statements and before the closing of the function.

**Step 4: Update `setGoal` to accept and persist tolerance**

Change the signature of `setGoal` (around line 599) to:

```typescript
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
```

Important: When calling `setGoal` with only a tolerance change (no target change), we need the existing target and direction to be preserved. However, looking at the current CLI code, the `goals` command only calls `setGoal` when a target value is provided. Tolerance-only updates require the caller to supply target + direction too, OR we handle it differently. For now, the simplest approach: `setGoal` always requires a target. If the user wants to update only tolerance, they also pass the target. This matches the current CLI pattern. We'll add a separate `setGoalTolerance` function for tolerance-only updates.

Add this function after `setGoal`:

```typescript
export function setGoalTolerance(key: string, tolerance: number): void {
  if (!VALID_GOAL_KEYS.has(key)) throw new Error(`Invalid goal key: ${key}`);
  const db = getDb();
  const existing = db.query("SELECT key FROM goals WHERE key = ?").get(key);
  if (!existing) throw new Error(`No goal set for ${key}. Set a target first.`);
  db.query(
    "UPDATE goals SET tolerance = ?, updated_at = datetime('now') WHERE key = ?"
  ).run(tolerance, key);
}
```

**Step 5: Update `getGoals` to read tolerance**

In `getGoals` (around line 610), update the query and mapping:

```typescript
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
```

**Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: Type errors in `cli.ts` because `setGoal` now has a different signature (the `cli.ts` calls `setGoal(g.key, g.target, g.direction)` which still works because `tolerance` is optional). Actually, this should still compile clean because `tolerance` is an optional 4th parameter. But there may be errors where `Goal.tolerance` is now expected but not used. Check and fix any errors.

**Step 7: Commit**

```bash
git add src/db.ts
git commit -m "feat: add tolerance column to goals schema + update Goal interface"
```

---

### Task 2: Update `goals` CLI Command

**Files:**
- Modify: `src/cli.ts:467-518` (goals case — add `--<macro>-tolerance` flag parsing, display tolerance)
- Modify: `src/cli.ts:1-27` (imports — add `setGoalTolerance` if needed)

**Step 1: Update the import in cli.ts**

Add `setGoalTolerance` to the import block at the top of `src/cli.ts`:

```typescript
import {
  // ... existing imports ...
  setGoal,
  setGoalTolerance,
  getGoals,
  resetGoals,
  // ... rest ...
} from "./db";
```

**Step 2: Update goals set logic to handle tolerance**

In the `goals` case (around line 476), update the loop that builds `toSet` to also capture tolerance flags:

```typescript
const macros = ["calories", "protein", "carbs", "fat"] as const;
const toSet: Array<{ key: string; target: number; direction?: "under" | "over"; tolerance?: number }> = [];
const tolOnly: Array<{ key: string; tolerance: number }> = [];
for (const m of macros) {
  const val = parseOptionalFloat(flags[m]);
  const tolVal = parseOptionalFloat(flags[`${m}-tolerance`]);
  if (val !== undefined) {
    const dirFlag = flags[`${m}-direction`];
    const direction = dirFlag === "over" || dirFlag === "under" ? dirFlag : undefined;
    toSet.push({ key: m, target: val, direction, tolerance: tolVal });
  } else if (tolVal !== undefined) {
    // Tolerance-only update (no new target)
    tolOnly.push({ key: m, tolerance: tolVal });
  }
}
```

**Step 3: Update the set logic to call setGoal with tolerance and handle tolerance-only updates**

Replace the `if (toSet.length > 0)` block:

```typescript
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
```

**Step 4: Update goals view to show tolerance**

In the goals view section (around line 505), update `goalsObj` to include tolerance:

```typescript
const goalsObj: Record<string, { target: number; direction: string; tolerance: number }> = {};
let latestUpdate = "";
for (const g of goals) {
  goalsObj[g.key] = { target: g.target, direction: g.direction, tolerance: g.tolerance };
  if (g.updatedAt > latestUpdate) latestUpdate = g.updatedAt;
}
```

Update the human-readable output to show tolerance when non-zero:

```typescript
printResult(
  { goals: { ...goalsObj, updatedAt: latestUpdate } },
  goals
    .map((g) => {
      const tolStr = g.tolerance > 0 ? ` ±${g.tolerance}%` : "";
      return `${g.key}: ${g.target} (${g.direction}${tolStr})`;
    })
    .join("\n") + `\n\nLast updated: ${latestUpdate}`
);
```

**Step 5: Update help text**

In `showHelp()` (around line 216), add tolerance flags to the goals section:

```
    --<macro>-tolerance <n>     Tolerance percentage (0-100) for grace zone
```

**Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors)

**Step 7: Quick manual test**

Run: `bun start goals --calories 2000 --calories-tolerance 10 --protein 120 --protein-tolerance 15`
Expected: `{ "success": true, "goalsSet": ["calories", "protein"] }`

Run: `bun start goals`
Expected: Goals output includes `"tolerance": 10` for calories and `"tolerance": 15` for protein.

**Step 8: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --<macro>-tolerance flags to goals command"
```

---

### Task 3: Zone Computation + Progress Output

**Files:**
- Modify: `src/cli.ts:521-693` (progress case — add zone logic, update today output, update streak logic)

**Step 1: Add the `computeZone` helper function**

Add this function somewhere before the `progress` case in `cli.ts` (e.g., right after `computeDateStr` around line 241):

```typescript
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
```

**Step 2: Update today's progress per macro in the `progress` case**

Replace the `todayProgress` block (around line 541):

```typescript
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
```

**Step 3: Update `meetsGoal` helper to use zone logic**

Replace the existing `meetsGoal` function inside the `progress` case (around line 550):

```typescript
function meetsGoal(day: DailyTotal | undefined, goal: Goal): boolean {
  if (!day || day.mealCount === 0) return false;
  const actual = day[goal.key as keyof DailyTotal] as number;
  const { zone } = computeZone(actual, goal.target, goal.direction, goal.tolerance);
  return zone === "met" || zone === "near";
}
```

**Step 4: Update goals object in progress output to include tolerance**

Replace the goals object builder (around line 537):

```typescript
const goalsObj: Record<string, { target: number; direction: string; tolerance: number }> = {};
for (const g of goals) goalsObj[g.key] = { target: g.target, direction: g.direction, tolerance: g.tolerance };
```

**Step 5: Update human-readable progress to show zone info**

In the human-readable output section (around line 668), update the per-macro line:

```typescript
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
```

**Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 7: Quick manual test**

Run:
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Test Meal" --calories 2100 --protein 115 --carbs 200 --fat 60
bun start goals --calories 2000 --calories-tolerance 10 --protein 120 --protein-tolerance 15
bun start progress
```

Expected progress output should show:
- calories: actual=2100, goal=2000, zone="near", band=2200, tolerance=10
- protein: actual=115, goal=120, zone="near", band=102, tolerance=15

**Step 8: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add zone computation + tolerance fields to progress output"
```

---

### Task 4: Smoke Test for Tolerance Bands

**Files:**
- Create: `scripts/smoke-test-tolerance.ts`
- Modify: `package.json` (add `smoke:tolerance` script)

**Step 1: Write the smoke test**

Create `scripts/smoke-test-tolerance.ts`:

```typescript
#!/usr/bin/env bun
/**
 * smoke-test-tolerance.ts
 * Tests tolerance band behavior end-to-end.
 * Run: bun scripts/smoke-test-tolerance.ts
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

// ========================================
// Test 1: Goals with tolerance = 0 (backward compatibility)
// ========================================
console.log("--- Tolerance = 0 (backward compat) ---");

run("log", "Test Meal", "--calories", "1800", "--protein", "130", "--carbs", "200", "--fat", "60");
run("goals", "--calories", "2000", "--protein", "120", "--carbs", "250", "--fat", "70");

const prog0 = run("progress");
check("Progress exit 0 (tol=0)", prog0.exitCode === 0);
const p0 = JSON.parse(prog0.stdout);

// Calories: actual=1800, goal=2000, direction=under → met (under target)
check("tol=0 calories.tolerance is 0", p0.today.calories.tolerance === 0);
check("tol=0 calories.zone is met", p0.today.calories.zone === "met");
check("tol=0 calories.band equals target", p0.today.calories.band === 2000);

// Protein: actual=130, goal=120, direction=over → met (above target)
check("tol=0 protein.zone is met", p0.today.protein.zone === "met");
check("tol=0 protein.band equals target", p0.today.protein.band === 120);

// ========================================
// Test 2: Set tolerance and check zones
// ========================================
console.log("\n--- Tolerance > 0, zone = near ---");

// Reset and set up
if (existsSync(dbPath)) rmSync(dbPath);

// Log a meal that goes OVER calorie target by a little (within 10% tolerance)
// Calories: target=2000, tolerance=10, direction=under
// actual=2100 → 2100 > 2000 but 2100 <= 2200 (2000*1.10) → near
run("log", "Over Meal", "--calories", "2100", "--protein", "115", "--carbs", "260", "--fat", "75");
run("goals", "--calories", "2000", "--calories-tolerance", "10",
    "--protein", "120", "--protein-tolerance", "15",
    "--carbs", "250", "--carbs-tolerance", "5",
    "--fat", "70", "--fat-tolerance", "0");

const prog1 = run("progress");
check("Progress exit 0 (tol>0)", prog1.exitCode === 0);
const p1 = JSON.parse(prog1.stdout);

// Calories: actual=2100, goal=2000, tol=10%, direction=under
// band = 2000 * 1.10 = 2200. 2100 <= 2200 → near
check("tol=10% calories.tolerance is 10", p1.today.calories.tolerance === 10);
check("tol=10% calories.band is 2200", p1.today.calories.band === 2200);
check("tol=10% calories.zone is near", p1.today.calories.zone === "near");

// Protein: actual=115, goal=120, tol=15%, direction=over
// band = 120 * 0.85 = 102. 115 >= 102 → near
check("tol=15% protein.tolerance is 15", p1.today.protein.tolerance === 15);
check("tol=15% protein.band is 102", p1.today.protein.band === 102);
check("tol=15% protein.zone is near", p1.today.protein.zone === "near");

// Carbs: actual=260, goal=250, tol=5%, direction=under
// band = 250 * 1.05 = 262.5. 260 <= 262.5 → near
check("tol=5% carbs.zone is near", p1.today.carbs.zone === "near");
check("tol=5% carbs.band is 262.5", p1.today.carbs.band === 262.5);

// Fat: actual=75, goal=70, tol=0%, direction=under
// band = 70 * 1.00 = 70. 75 > 70 → over
check("tol=0% fat.zone is over", p1.today.fat.zone === "over");
check("tol=0% fat.band is 70", p1.today.fat.band === 70);

// ========================================
// Test 3: Zone = missed (outside band)
// ========================================
console.log("\n--- Zone = missed (outside band) ---");

if (existsSync(dbPath)) rmSync(dbPath);

// Calories: actual=2300, goal=2000, tol=10% → band=2200, 2300 > 2200 → over
run("log", "Big Meal", "--calories", "2300", "--protein", "90", "--carbs", "300", "--fat", "100");
run("goals", "--calories", "2000", "--calories-tolerance", "10",
    "--protein", "120", "--protein-tolerance", "15");

const prog2 = run("progress");
const p2 = JSON.parse(prog2.stdout);

check("over-band calories.zone is over", p2.today.calories.zone === "over");

// Protein: actual=90, goal=120, tol=15%, direction=over
// band = 120 * 0.85 = 102. 90 < 102 → under
check("under-band protein.zone is under", p2.today.protein.zone === "under");

// ========================================
// Test 4: Zone = met (on correct side)
// ========================================
console.log("\n--- Zone = met (correct side, with tolerance) ---");

if (existsSync(dbPath)) rmSync(dbPath);

run("log", "Good Meal", "--calories", "1800", "--protein", "140");
run("goals", "--calories", "2000", "--calories-tolerance", "10",
    "--protein", "120", "--protein-tolerance", "15");

const prog3 = run("progress");
const p3 = JSON.parse(prog3.stdout);

// Calories: actual=1800, goal=2000, direction=under → met (clearly under)
check("met calories.zone is met", p3.today.calories.zone === "met");
// Protein: actual=140, goal=120, direction=over → met (clearly over)
check("met protein.zone is met", p3.today.protein.zone === "met");

// ========================================
// Test 5: Streaks use zone logic (near sustains streak)
// ========================================
console.log("\n--- Streaks with tolerance ---");

if (existsSync(dbPath)) rmSync(dbPath);

// Log 3 days: day -2 met, day -1 near, day 0 met
// All should sustain streak → current streak = 3
const now = new Date();
function dateStr(offset: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// We need to insert meals with specific dates. Use the DB directly via CLI.
// Day -2: 1800 cal (met, under 2000)
run("log", "Day -2", "--calories", "1800", "--protein", "130");
// Day -1: 2100 cal (near, within 10% of 2000)
run("log", "Day -1", "--calories", "2100", "--protein", "115");
// Day 0: 1900 cal (met, under 2000)
run("log", "Day 0", "--calories", "1900", "--protein", "125");

// Problem: all meals are logged "today" because log uses datetime('now').
// For proper streak testing, we need the seed approach.
// Instead, let's use the existing seed script pattern: write a helper.
// Actually, let's just verify with what we have. All 3 meals are on the same day (today).
// So today's totals = 1800+2100+1900=5800 cal, which is way over.
// This won't work for multi-day streak testing.

// Better approach: verify that meetsGoal uses zone logic by checking
// that the streaks numbers are plausible with the seeded data.
// Let's seed the month and set goals with tolerance.

if (existsSync(dbPath)) rmSync(dbPath);

// Seed 28 days of data
const seedResult = Bun.spawnSync(["bun", "scripts/seed-month.ts"], { cwd: projectRoot, stderr: "pipe" });
check("Seed ran for streak test", (seedResult.exitCode ?? 1) === 0);

// Set goals that the seeded data sometimes meets and sometimes doesn't,
// but tolerance should make "near" days count too.
// Seeded data: daily calories min=1396, max=1833, avg=1617
// Set calorie goal = 1600 under → some days over 1600 but within tolerance
// With tolerance 20% → band = 1600 * 1.20 = 1920. All days ≤ 1833 < 1920 → all met or near
run("goals", "--calories", "1600", "--calories-tolerance", "20");

const progStreak = run("progress");
const pStreak = JSON.parse(progStreak.stdout);

// With tol=20%, band=1920. All days have calories ≤ 1833 < 1920.
// Days with cal ≤ 1600 → met. Days with 1600 < cal ≤ 1920 → near.
// Both sustain streaks. So current streak should include all 28+today days.
check("Streak current >= 28 with tolerance", pStreak.streaks.calories.current >= 28,
  `got ${pStreak.streaks.calories.current}`);

// Now set tolerance = 0 and check that streaks are shorter
// (because days over 1600 break the streak)
run("goals", "--calories", "1600", "--calories-tolerance", "0");
const progNoTol = run("progress");
const pNoTol = JSON.parse(progNoTol.stdout);

check("Streak shorter without tolerance", pNoTol.streaks.calories.current < pStreak.streaks.calories.current,
  `tol=0 streak=${pNoTol.streaks.calories.current}, tol=20 streak=${pStreak.streaks.calories.current}`);

// ========================================
// Test 6: Goals view includes tolerance
// ========================================
console.log("\n--- Goals view includes tolerance ---");

if (existsSync(dbPath)) rmSync(dbPath);

run("goals", "--calories", "2000", "--calories-tolerance", "10", "--protein", "120");
const goalsView = run("goals");
const gv = JSON.parse(goalsView.stdout);

check("Goals view calories.tolerance is 10", gv.goals.calories.tolerance === 10);
check("Goals view protein.tolerance is 0", gv.goals.protein.tolerance === 0);

// ========================================
// Test 7: Tolerance-only update
// ========================================
console.log("\n--- Tolerance-only update ---");

// Already have goals set. Update only tolerance for protein.
const tolUpdate = run("goals", "--protein-tolerance", "20");
check("Tolerance-only update succeeds", tolUpdate.exitCode === 0);
const tolJson = JSON.parse(tolUpdate.stdout);
check("Tolerance-only update includes protein", tolJson.goalsSet?.includes("protein"));

const goalsAfter = run("goals");
const gaJson = JSON.parse(goalsAfter.stdout);
check("Protein tolerance updated to 20", gaJson.goals.protein.tolerance === 20);
check("Protein target unchanged at 120", gaJson.goals.protein.target === 120);

// ========================================
// Test 8: Tolerance-only update fails without existing goal
// ========================================
console.log("\n--- Tolerance-only without goal ---");

const badTol = run("goals", "--fat-tolerance", "10");
check("Tolerance without goal fails (exit 1)", badTol.exitCode === 1);

// ========================================
// Test 9: Goals progress output always has tolerance/band/zone fields
// ========================================
console.log("\n--- Progress always has new fields ---");

if (existsSync(dbPath)) rmSync(dbPath);

run("log", "Meal", "--calories", "500", "--protein", "30");
run("goals", "--calories", "2000", "--protein", "120");

const progFields = run("progress");
const pf = JSON.parse(progFields.stdout);

for (const macro of ["calories", "protein"]) {
  const m = pf.today[macro];
  check(`${macro} has tolerance field`, typeof m.tolerance === "number");
  check(`${macro} has band field`, typeof m.band === "number");
  check(`${macro} has zone field`, typeof m.zone === "string");
}

// Goals output also has tolerance
check("progress goals.calories.tolerance present", typeof pf.goals.calories.tolerance === "number");

// ========================================
// Test 10: Human-readable shows zone
// ========================================
console.log("\n--- Human mode with tolerance ---");

if (existsSync(dbPath)) rmSync(dbPath);

run("log", "Meal", "--calories", "2100");
run("goals", "--calories", "2000", "--calories-tolerance", "10");

const humanOut = run("progress", "--human");
check("Human output contains [near]", humanOut.stdout.includes("[near]"));

// ========================================
// Summary
// ========================================
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
```

**Step 2: Add the npm script**

In `package.json`, add to scripts:

```json
"smoke:tolerance": "bun scripts/smoke-test-tolerance.ts"
```

**Step 3: Run the smoke test**

Run: `bun run smoke:tolerance`
Expected: ALL CHECKS PASSED

If any checks fail, fix the issues. Common problems:
- Rounding: `band` computation may differ by 0.1 due to floating point. The `computeZone` function rounds to 1 decimal.
- Streak test: the seeded data pattern may not match exactly. Adjust expectations or debug.

**Step 4: Run existing smoke tests to check for regressions**

Run: `bun run smoke:goals`
Expected: 57/57 PASS (no regressions — tolerance defaults to 0)

Run: `bun run smoke:month`
Expected: 29/29 PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add scripts/smoke-test-tolerance.ts package.json
git commit -m "test: add tolerance band smoke test (10 scenarios)"
```

---

### Task 5: Update AGENTS.md Documentation

**Files:**
- Modify: `AGENTS.md`

**Step 1: Update the goals command section**

In the goals command section, add tolerance flags:

Under the `goals [options]` CLI Commands section:
```
  goals [options]              View or set daily nutrition goals
    --calories <n>             Daily calorie target
    --protein <n>              Daily protein target (g)
    --carbs <n>                Daily carbs target (g)
    --fat <n>                  Daily fat target (g)
    --<macro>-direction <d>    Goal direction: under or over
    --<macro>-tolerance <n>    Tolerance percentage (0-100) for grace zone
    --reset                    Clear all goals
```

**Step 2: Update goals JSON output example**

Update the goals view JSON to show tolerance:

```json
{
  "goals": {
    "calories": { "target": 2000, "direction": "under", "tolerance": 10 },
    "protein": { "target": 120, "direction": "over", "tolerance": 15 },
    "carbs": { "target": 250, "direction": "under", "tolerance": 0 },
    "fat": { "target": 65, "direction": "under", "tolerance": 0 },
    "updatedAt": "2026-02-21 12:00:00"
  }
}
```

**Step 3: Update progress JSON output example**

Update the progress `today` section to include the new fields:

```json
"today": {
  "calories": { "actual": 1500, "goal": 2000, "remaining": 500, "percent": 75, "tolerance": 10, "band": 2200, "zone": "met" },
  "protein": { "actual": 95, "goal": 120, "remaining": 25, "percent": 79, "tolerance": 15, "band": 102, "zone": "near" },
  "mealCount": 3
}
```

**Step 4: Update progress goals section to include tolerance**

```json
"goals": {
  "calories": { "target": 2000, "direction": "under", "tolerance": 10 },
  "protein": { "target": 120, "direction": "over", "tolerance": 15 }
}
```

**Step 5: Add a section about tolerance/zone semantics**

Add after the streak semantics section:

```markdown
Tolerance/zone semantics:
- Tolerance is a percentage (0-100) per goal creating a grace zone
- `zone: "met"` means actual is on the correct side of the target
- `zone: "near"` means actual is within the grace zone (tolerance > 0 only)
- `zone: "over"` or `"under"` means actual missed the goal beyond the grace zone
- `band` is the computed edge of the grace zone
- Both "met" and "near" sustain streaks
- Tolerance defaults to 0 (no grace zone, binary met/missed behavior)
```

**Step 6: Update testing section**

Add to the testing section:

```bash
# Test tolerance
bun start goals --calories 2000 --calories-tolerance 10 --human
bun start progress --human

# Run tolerance smoke test
bun run smoke:tolerance
```

**Step 7: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add tolerance band documentation to AGENTS.md"
```

---

### Task 6: Final Verification

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 2: Run all smoke tests**

Run: `bun run smoke:goals && bun run smoke:month && bun run smoke:tolerance`
Expected: All pass with no regressions.

**Step 3: Verify git is clean**

Run: `git status`
Expected: Clean working tree, no uncommitted changes.
