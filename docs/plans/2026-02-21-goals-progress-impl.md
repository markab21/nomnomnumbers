# Goals & Progress System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `goals` and `progress` commands to the NomNom CLI — daily macro targets, streak tracking, weekly averages, all in one JSON response for agent consumption.

**Architecture:** Goals stored in a new `goals` SQLite table in `nomnom.db`. The `goals` command handles CRUD. The `progress` command computes today-vs-goals, streaks (walking backwards through daily totals), and a 7-day rolling average. All streak/avg computation is done at query time via SQL + a thin JS loop — no stored state to go stale.

**Tech Stack:** Bun CLI, SQLite (WAL mode), TypeScript strict

---

## Task 1: Goals Table Schema + DB Functions

**Files:**
- Modify: `src/db.ts` (add goals table to `initTables` at line 271, add new exported functions after line 573)

**Step 1: Add goals table to `initTables`**

In `src/db.ts`, inside `initTables()` (line 271), after the meals table and indexes, add:

```sql
CREATE TABLE IF NOT EXISTS goals (
  key TEXT PRIMARY KEY,
  target REAL NOT NULL,
  direction TEXT NOT NULL DEFAULT 'under',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 2: Add Goal interface and CRUD functions**

After `getUSDAPath()` (line 573), add these exports to `src/db.ts`:

```typescript
// ---- Goals ----

export interface Goal {
  key: string;
  target: number;
  direction: "under" | "over";
  updatedAt: string;
}

const VALID_GOAL_KEYS = new Set(["calories", "protein", "carbs", "fat"]);
const DEFAULT_DIRECTIONS: Record<string, "under" | "over"> = {
  calories: "under",
  protein: "over",
  carbs: "under",
  fat: "under",
};

export function setGoal(key: string, target: number, direction?: "under" | "over"): void {
  if (!VALID_GOAL_KEYS.has(key)) throw new Error(`Invalid goal key: ${key}`);
  const db = getDb();
  const dir = direction ?? DEFAULT_DIRECTIONS[key] ?? "under";
  db.query(
    `INSERT INTO goals (key, target, direction, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET target = excluded.target, direction = excluded.direction, updated_at = datetime('now')`
  ).run(key, target, dir);
}

export function getGoals(): Goal[] {
  const db = getDb();
  const rows = db.query(
    `SELECT key, target, direction, updated_at FROM goals ORDER BY key`
  ).all() as Array<{ key: string; target: number; direction: string; updated_at: string }>;
  return rows.map((r) => ({
    key: r.key,
    target: r.target,
    direction: r.direction as "under" | "over",
    updatedAt: r.updated_at,
  }));
}

export function resetGoals(): void {
  const db = getDb();
  db.query("DELETE FROM goals").run();
}
```

**Step 3: Add `getAllDailyTotals` for efficient streak/avg computation**

Also add to `src/db.ts`:

```typescript
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
```

**Step 4: Run typecheck**

```bash
bun run typecheck
```

**Step 5: Verify with a quick manual test**

```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun -e "
  const { setGoal, getGoals, resetGoals, initializeDatabase } = require('./src/db');
  initializeDatabase();
  setGoal('calories', 2000);
  setGoal('protein', 120, 'over');
  console.log(JSON.stringify(getGoals(), null, 2));
  resetGoals();
  console.log('After reset:', getGoals().length);
"
```

Expected: Two goals printed, then `After reset: 0`.

**Step 6: Commit**

```bash
git add src/db.ts
git commit -m "feat: add goals table schema and CRUD + getAllDailyTotals"
```

---

## Task 2: `goals` CLI Command

**Files:**
- Modify: `src/cli.ts` (add import at line 2, add case before `default:` at line 447)

**Step 1: Update imports at top of `src/cli.ts`**

Add to the import block (after line 20):

```typescript
import {
  // ... existing imports ...
  setGoal,
  getGoals,
  resetGoals,
  type Goal,
} from "./db";
```

**Step 2: Add `goals` case to the switch statement**

Before the `default:` case (line 447), add:

```typescript
    case "goals": {
      // Reset
      if (flags.reset) {
        resetGoals();
        printResult({ success: true }, "Goals reset");
        break;
      }

      // Set goals (at least one macro flag required)
      const macros = ["calories", "protein", "carbs", "fat"] as const;
      const toSet: Array<{ key: string; target: number; direction?: "under" | "over" }> = [];
      for (const m of macros) {
        const val = parseOptionalFloat(flags[m]);
        if (val !== undefined) {
          const dirFlag = flags[`${m}-direction`];
          const direction = dirFlag === "over" || dirFlag === "under" ? dirFlag : undefined;
          toSet.push({ key: m, target: val, direction });
        }
      }

      if (toSet.length > 0) {
        for (const g of toSet) {
          setGoal(g.key, g.target, g.direction);
        }
        printResult(
          { success: true, goalsSet: toSet.map((g) => g.key) },
          `Goals set: ${toSet.map((g) => `${g.key}=${g.target}`).join(", ")}`
        );
        break;
      }

      // View goals
      const goals = getGoals();
      if (goals.length === 0) {
        printResult({ goals: null }, "No goals set. Use: nomnom goals --calories 2000 --protein 120");
        break;
      }

      const goalsObj: Record<string, { target: number; direction: string }> = {};
      let latestUpdate = "";
      for (const g of goals) {
        goalsObj[g.key] = { target: g.target, direction: g.direction };
        if (g.updatedAt > latestUpdate) latestUpdate = g.updatedAt;
      }

      printResult(
        { goals: { ...goalsObj, updatedAt: latestUpdate } },
        goals
          .map((g) => `${g.key}: ${g.target} (${g.direction})`)
          .join("\n") + `\n\nLast updated: ${latestUpdate}`
      );
      break;
    }
```

**Step 3: Update `showHelp()` (line 177)**

Add after the `history` section:

```
  goals [options]              View or set daily nutrition goals
    --calories <n>             Daily calorie target
    --protein <n>              Daily protein target (g)
    --carbs <n>                Daily carbs target (g)
    --fat <n>                  Daily fat target (g)
    --<macro>-direction <d>    Goal direction: under or over
    --reset                    Clear all goals

  progress [options]           Show progress vs goals (streaks, weekly avg)
    --date <n>                 Day offset (0=today, -1=yesterday)
```

**Step 4: Run typecheck and test**

```bash
bun run typecheck
rm -f ~/.local/share/nomnom/nomnom.db
bun start goals --calories 2000 --protein 120 --carbs 250 --fat 65
bun start goals
bun start goals --reset
bun start goals
```

Expected: Set → view shows 4 goals → reset → view shows null.

**Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add goals CLI command (set, view, reset)"
```

---

## Task 3: `progress` CLI Command

**Files:**
- Modify: `src/cli.ts` (add import for `getAllDailyTotals` and `DailyTotal`, add `progress` case)

This is the most complex task. The `progress` command needs to:
1. Load goals (error if none set)
2. Compute today's actuals vs goals
3. Compute streaks by walking backwards through daily totals
4. Compute 7-day rolling average

**Step 1: Update imports**

Add `getAllDailyTotals` and `type DailyTotal` to the import from `"./db"`.

**Step 2: Add helper function `computeDateStr` before `main()`**

```typescript
function computeDateStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

**Step 3: Refactor `today` case to use `computeDateStr`**

Replace lines 404–408 in the `today` case with:

```typescript
    case "today": {
      const offsetDays = parseInt(flags.date ?? "0", 10);
      const today = computeDateStr(isNaN(offsetDays) ? 0 : offsetDays);
```

**Step 4: Add `progress` case before `default:`**

```typescript
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
      const goalsObj: Record<string, { target: number; direction: string }> = {};
      for (const g of goals) goalsObj[g.key] = { target: g.target, direction: g.direction };

      // Today's progress per macro
      const todayProgress: Record<string, { actual: number; goal: number; remaining: number; percent: number }> = {};
      for (const g of goals) {
        const actual = todayTotals[g.key as keyof typeof todayTotals] as number;
        const remaining = g.target - actual;
        const percent = g.target === 0 ? (actual === 0 ? 100 : 999) : Math.round((actual / g.target) * 100);
        todayProgress[g.key] = { actual, goal: g.target, remaining: Math.round(remaining * 10) / 10, percent };
      }

      // Helper: check if a day meets a single goal
      function meetsGoal(day: DailyTotal | undefined, goal: Goal): boolean {
        if (!day || day.mealCount === 0) return false;
        const actual = day[goal.key as keyof DailyTotal] as number;
        return goal.direction === "under" ? actual <= goal.target : actual >= goal.target;
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
        humanLines.push(
          `${label.padEnd(9)} ${String(p.actual).padStart(7)} / ${String(p.goal).padStart(5)}  (${String(p.percent).padStart(3)}%) ${bar(p.percent)} ${remaining}`
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
```

**Step 5: Run typecheck**

```bash
bun run typecheck
```

**Step 6: Manual end-to-end test with seeded data**

```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun scripts/seed-month.ts
bun start goals --calories 2000 --protein 100 --carbs 250 --fat 65
bun start progress
bun start progress --date -7
bun start progress --human
```

Verify:
- JSON output has all fields (date, goals, today, streaks, weeklyAvg)
- Streaks are non-negative integers
- Weekly avg makes sense (~1550-1650 range)
- Human output has progress bars

**Step 7: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add progress CLI command with streaks and weekly avg"
```

---

## Task 4: Smoke Test for Goals + Progress

**Files:**
- Create: `scripts/smoke-test-goals.ts`

This script validates the complete goals + progress flow:

1. Reset DB
2. Seed 28 days of meals
3. Set goals via CLI
4. Run `goals` to verify they were stored
5. Run `progress` for today and for day -14
6. Validate all JSON fields
7. Verify streaks are reasonable (current <= best, both >= 0)
8. Verify weekly avg matches expectations
9. Reset goals, verify progress fails with error

```typescript
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
```

**Step 1: Create the file**

Write `scripts/smoke-test-goals.ts` with the above content.

**Step 2: Run it**

```bash
bun scripts/smoke-test-goals.ts
```

Expected: ALL CHECKS PASSED

**Step 3: Add npm script to package.json**

Add to scripts: `"smoke:goals": "bun scripts/smoke-test-goals.ts"`

**Step 4: Commit**

```bash
git add scripts/smoke-test-goals.ts package.json
git commit -m "feat: add goals + progress smoke test"
```

---

## Task 5: Update AGENTS.md Documentation

**Files:**
- Modify: `AGENTS.md`

Add documentation for the new `goals` and `progress` commands following the existing patterns. Include:
- Command syntax with all flags
- JSON output examples for both commands
- Brief description of streak calculation semantics

**Step 1: Add to the CLI Commands table**

After the `history` entry, add `goals` and `progress`.

**Step 2: Add Command Details sections**

Follow the same format as existing commands (search, lookup, log, etc.) with full JSON examples matching the design doc.

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document goals and progress commands in AGENTS.md"
```

---

## Pass Criteria

- `bun run typecheck` passes clean
- `bun start goals --calories 2000 --protein 120` sets goals correctly
- `bun start goals` returns JSON with all set goals
- `bun start progress` returns complete JSON with today, streaks, weeklyAvg
- `bun start progress --date -7` works for historical dates
- `bun start progress --human` shows progress bars and streaks
- `bun scripts/smoke-test-goals.ts` exits 0 with ALL CHECKS PASSED
- `bun scripts/smoke-test-month.ts` still passes (no regressions)
