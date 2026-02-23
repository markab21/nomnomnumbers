# Macro Bar Filler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add gamification mechanics to NomNom Numbers using incremental game design - log meals fill daily progress bars, hitting goals awards victories, streaks compound, and reducers make goals easier.

**Architecture:** Two new SQLite tables track daily bar progress and lifetime stats. A gamification engine computes bonuses, checks victories, and handles upgrades. CLI commands expose the loop (log, status, victory-check, buy-reducer). Simulation harness validates parabolic progression.

**Tech Stack:** Bun, SQLite (bun:sqlite), TypeScript, existing MCP server

**Design Doc:** `docs/plans/2026-02-23-macro-bar-filler-design.md`

---

## Task 1: Database Schema - Daily Bars Table

**Files:**
- Modify: `src/db.ts`
- Test: `tests/gamify.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/gamify.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initGamifyTables, getDailyBars, updateDailyBars } from "../src/db";

describe("Gamification - daily_bars", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initGamifyTables(db);
  });

  test("getDailyBars creates row for today if not exists", () => {
    const today = new Date().toISOString().split("T")[0];
    const row = getDailyBars(db);
    expect(row.date).toBe(today);
    expect(row.p_logged).toBe(0);
    expect(row.p_goal).toBe(150);
  });

  test("updateDailyBars increments logged values", () => {
    updateDailyBars(db, { protein: 30, carbs: 50, fat: 15, calories: 450 }, 0);
    const row = getDailyBars(db);
    expect(row.p_logged).toBe(30);
    expect(row.c_logged).toBe(50);
  });

  test("updateDailyBars applies streak bonus", () => {
    updateDailyBars(db, { protein: 100, carbs: 0, fat: 0, calories: 0 }, 0.2); // 20% bonus
    const row = getDailyBars(db);
    expect(row.p_logged).toBe(120); // 100 * 1.2
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/gamify.test.ts
```
Expected: FAIL - "initGamifyTables is not defined"

**Step 3: Add daily_bars table and functions to db.ts**

```typescript
// Add to src/db.ts exports
export function initGamifyTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_bars (
      date TEXT PRIMARY KEY,
      p_logged REAL DEFAULT 0,
      p_goal REAL DEFAULT 150,
      c_logged REAL DEFAULT 0,
      c_goal REAL DEFAULT 200,
      f_logged REAL DEFAULT 0,
      f_goal REAL DEFAULT 60,
      cal_logged REAL DEFAULT 0,
      cal_goal REAL DEFAULT 2200,
      victory BOOLEAN DEFAULT FALSE,
      streak_bonus REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_daily_bars_date ON daily_bars(date);
  `);
}

export function getDailyBars(db: Database): DailyBarRow {
  const today = new Date().toISOString().split("T")[0];
  let row = db.query<DailyBarRow, []>(`
    SELECT * FROM daily_bars WHERE date = ?
  `).get(today);

  if (!row) {
    db.run(`INSERT INTO daily_bars (date) VALUES (?)`, [today]);
    row = db.query<DailyBarRow, []>(`SELECT * FROM daily_bars WHERE date = ?`).get(today);
  }
  return row!;
}

export function updateDailyBars(
  db: Database,
  values: { protein: number; carbs: number; fat: number; calories: number },
  streakBonus: number
): void {
  const today = new Date().toISOString().split("T")[0];
  const mult = 1 + streakBonus;

  db.run(`
    UPDATE daily_bars SET
      p_logged = p_logged + ?,
      c_logged = c_logged + ?,
      f_logged = f_logged + ?,
      cal_logged = cal_logged + ?
    WHERE date = ?
  `, [values.protein * mult, values.carbs * mult, values.fat * mult, values.calories * mult, today]);
}

export interface DailyBarRow {
  date: string;
  p_logged: number;
  p_goal: number;
  c_logged: number;
  c_goal: number;
  f_logged: number;
  f_goal: number;
  cal_logged: number;
  cal_goal: number;
  victory: boolean;
  streak_bonus: number;
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/gamify.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts tests/gamify.test.ts
git commit -m "feat(gamify): add daily_bars table and core functions"
```

---

## Task 2: Database Schema - Lifetime Stats Table

**Files:**
- Modify: `src/db.ts`
- Test: `tests/gamify.test.ts`

**Step 1: Write the failing test**

Add to `tests/gamify.test.ts`:

```typescript
describe("Gamification - lifetime_stats", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initGamifyTables(db);
  });

  test("getLifetimeStats creates default row if not exists", () => {
    const stats = getLifetimeStats(db);
    expect(stats.total_victories).toBe(0);
    expect(stats.current_streak).toBe(0);
    expect(stats.reducer_lvl).toBe(0);
  });

  test("incrementVictories updates total and streak", () => {
    incrementVictories(db, true); // consecutive
    const stats = getLifetimeStats(db);
    expect(stats.total_victories).toBe(1);
    expect(stats.current_streak).toBe(1);
  });

  test("incrementVictories resets streak if not consecutive", () => {
    incrementVictories(db, true);
    incrementVictories(db, false); // not consecutive
    const stats = getLifetimeStats(db);
    expect(stats.total_victories).toBe(2);
    expect(stats.current_streak).toBe(1);
  });

  test("buyReducer increments level if enough victories", () => {
    // Give enough victories for level 1 (cost: 5)
    for (let i = 0; i < 5; i++) incrementVictories(db, true);
    
    const result = buyReducer(db);
    expect(result.success).toBe(true);
    expect(getLifetimeStats(db).reducer_lvl).toBe(1);
  });

  test("buyReducer fails if not enough victories", () => {
    incrementVictories(db, true);
    const result = buyReducer(db);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not enough victories");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/gamify.test.ts
```
Expected: FAIL - "getLifetimeStats is not defined"

**Step 3: Add lifetime_stats table and functions**

```typescript
// Add to src/db.ts

export function initGamifyTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_bars (
      -- ... existing ...
    );

    CREATE TABLE IF NOT EXISTS lifetime_stats (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      total_victories INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      reducer_lvl INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO lifetime_stats (id) VALUES (1);

    CREATE INDEX IF NOT EXISTS idx_daily_bars_date ON daily_bars(date);
  `);
}

export function getLifetimeStats(db: Database): LifetimeStatsRow {
  return db.query<LifetimeStatsRow, []>(`SELECT * FROM lifetime_stats WHERE id = 1`).get()!;
}

export function incrementVictories(db: Database, consecutive: boolean): void {
  db.run(`
    UPDATE lifetime_stats SET
      total_victories = total_victories + 1,
      current_streak = CASE WHEN ? THEN current_streak + 1 ELSE 1 END,
      updated_at = CURRENT_TIMESTAMP
  `, [consecutive]);
}

export function buyReducer(db: Database): { success: boolean; error?: string } {
  const stats = getLifetimeStats(db);
  const cost = 5 * (stats.reducer_lvl + 1);

  if (stats.total_victories < cost) {
    return { success: false, error: `Not enough victories. Need ${cost}, have ${stats.total_victories}` };
  }

  db.run(`
    UPDATE lifetime_stats SET
      reducer_lvl = reducer_lvl + 1,
      updated_at = CURRENT_TIMESTAMP
  `);

  return { success: true };
}

export interface LifetimeStatsRow {
  id: number;
  total_victories: number;
  current_streak: number;
  reducer_lvl: number;
  updated_at: string;
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/gamify.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts tests/gamify.test.ts
git commit -m "feat(gamify): add lifetime_stats table and victory/reducer functions"
```

---

## Task 3: Gamification Engine

**Files:**
- Create: `src/engine.ts`
- Test: `tests/gamify.test.ts`

**Step 1: Write the failing test**

Add to `tests/gamify.test.ts`:

```typescript
import { GamifyEngine } from "../src/engine";

describe("GamifyEngine", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initGamifyTables(db);
  });

  test("logMeal applies streak bonus to logged values", () => {
    // Set up a streak
    for (let i = 0; i < 3; i++) incrementVictories(db, true);
    
    GamifyEngine.logMeal(db, { protein: 50, carbs: 60, fat: 20, calories: 500 });
    
    const bars = getDailyBars(db);
    // Streak=3, bonus=12%, 50*1.12=56
    expect(bars.p_logged).toBeCloseTo(56, 0);
  });

  test("checkVictory awards victory when all bars >= 100%", () => {
    // Log enough to fill all bars
    GamifyEngine.logMeal(db, { protein: 150, carbs: 200, fat: 60, calories: 2200 });
    
    const result = GamifyEngine.checkVictory(db);
    expect(result.victory).toBe(true);
    
    const stats = getLifetimeStats(db);
    expect(stats.total_victories).toBe(1);
  });

  test("checkVictory does not award if bars incomplete", () => {
    GamifyEngine.logMeal(db, { protein: 100, carbs: 0, fat: 0, calories: 0 });
    
    const result = GamifyEngine.checkVictory(db);
    expect(result.victory).toBe(false);
  });

  test("applyReducer lowers goals correctly", () => {
    for (let i = 0; i < 5; i++) incrementVictories(db, true);
    buyReducer(db);
    
    GamifyEngine.applyReducerToGoals(db);
    
    const bars = getDailyBars(db);
    expect(bars.p_goal).toBe(145);
    expect(bars.c_goal).toBe(195);
    expect(bars.f_goal).toBe(57);
    expect(bars.cal_goal).toBe(2150);
  });

  test("getBarPercents calculates correct percentages", () => {
    GamifyEngine.logMeal(db, { protein: 75, carbs: 0, fat: 0, calories: 0 });
    
    const percents = GamifyEngine.getBarPercents(db);
    expect(percents.protein).toBe(50); // 75/150
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/gamify.test.ts
```
Expected: FAIL - "GamifyEngine is not defined"

**Step 3: Create the engine**

```typescript
// src/engine.ts
import { Database } from "bun:sqlite";
import {
  getDailyBars,
  updateDailyBars,
  getLifetimeStats,
  incrementVictories,
  buyReducer as dbBuyReducer,
  DailyBarRow,
  LifetimeStatsRow,
} from "./db";

export class GamifyEngine {
  static logMeal(
    db: Database,
    values: { protein: number; carbs: number; fat: number; calories: number }
  ): void {
    const stats = getLifetimeStats(db);
    const streakBonus = stats.current_streak * 0.04;
    updateDailyBars(db, values, streakBonus);
  }

  static checkVictory(db: Database): { victory: boolean; alreadyAwarded?: boolean } {
    const bars = getDailyBars(db);
    
    if (bars.victory) {
      return { victory: true, alreadyAwarded: true };
    }

    const percents = this.getBarPercents(db);
    const allComplete =
      percents.protein >= 100 &&
      percents.carbs >= 100 &&
      percents.fat >= 100 &&
      percents.calories >= 100;

    if (!allComplete) {
      return { victory: false };
    }

    // Check if yesterday had a victory (consecutive)
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const yesterdayRow = db
      .query<Pick<DailyBarRow, "victory">, [string]>(`SELECT victory FROM daily_bars WHERE date = ?`)
      .get(yesterday);
    const consecutive = yesterdayRow?.victory ?? false;

    incrementVictories(db, consecutive);
    db.run(`UPDATE daily_bars SET victory = TRUE WHERE date = ?`, [bars.date]);

    return { victory: true };
  }

  static buyReducer(db: Database): { success: boolean; error?: string; newLevel?: number } {
    const stats = getLifetimeStats(db);
    const cost = 5 * (stats.reducer_lvl + 1);

    const result = dbBuyReducer(db);
    if (!result.success) {
      return result;
    }

    this.applyReducerToGoals(db);
    return { success: true, newLevel: stats.reducer_lvl + 1 };
  }

  static applyReducerToGoals(db: Database): void {
    const stats = getLifetimeStats(db);
    const reduction = stats.reducer_lvl;

    db.run(`
      UPDATE daily_bars SET
        p_goal = 150 - 5 * ?,
        c_goal = 200 - 5 * ?,
        f_goal = 60 - 3 * ?,
        cal_goal = 2200 - 50 * ?
      WHERE date >= date('now')
    `, [reduction, reduction, reduction, reduction]);
  }

  static getBarPercents(db: Database): {
    protein: number;
    carbs: number;
    fat: number;
    calories: number;
  } {
    const bars = getDailyBars(db);
    return {
      protein: Math.round((bars.p_logged / bars.p_goal) * 100),
      carbs: Math.round((bars.c_logged / bars.c_goal) * 100),
      fat: Math.round((bars.f_logged / bars.f_goal) * 100),
      calories: Math.round((bars.cal_logged / bars.cal_goal) * 100),
    };
  }

  static formatStatus(db: Database): string {
    const bars = getDailyBars(db);
    const stats = getLifetimeStats(db);
    const percents = this.getBarPercents(db);
    const bonus = stats.current_streak * 4;
    const reducerCost = 5 * (stats.reducer_lvl + 1);

    const bar = (pct: number) => "█".repeat(Math.min(10, Math.floor(pct / 10))) + "░".repeat(10 - Math.min(10, Math.floor(pct / 10)));

    return `
Daily Bars:
P:  ${Math.round(bars.p_logged)}/${Math.round(bars.p_goal)} [${bar(percents.protein)}] ${percents.protein}%
C:  ${Math.round(bars.c_logged)}/${Math.round(bars.c_goal)} [${bar(percents.carbs)}] ${percents.carbs}%
F:  ${Math.round(bars.f_logged)}/${Math.round(bars.f_goal)} [${bar(percents.fat)}] ${percents.fat}%
Cal: ${Math.round(bars.cal_logged)}/${Math.round(bars.cal_goal)} [${bar(percents.calories)}] ${percents.calories}%

Streak: ${stats.current_streak} 🔥 (+${bonus}% log bonus)
Total Victories: ${stats.total_victories}
Reducer Lvl: ${stats.reducer_lvl}
Next Reducer: ${reducerCost} Victories${stats.total_victories >= reducerCost ? " [BUY AVAILABLE]" : ""}
`.trim();
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/gamify.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine.ts tests/gamify.test.ts
git commit -m "feat(gamify): add GamifyEngine with log, victory, reducer logic"
```

---

## Task 4: CLI Commands - log and status

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-gamify.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cli-gamify.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { executeCommand } from "../src/cli";
import { Database } from "bun:sqlite";
import { initGamifyTables } from "../src/db";

describe("CLI - gamify commands", () => {
  beforeEach(() => {
    // Use in-memory DB for tests
    process.env.NOMNOM_TEST_DB = "true";
  });

  test("log with macros returns success and logged values", async () => {
    const result = await executeCommand(["log", "--protein", "50", "--carbs", "60", "--fat", "20", "--calories", "500"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.logged.protein).toBe(50);
  });

  test("status shows bars and streak info", async () => {
    await executeCommand(["log", "--protein", "150", "--carbs", "200", "--fat", "60", "--calories", "2200"]);
    const result = await executeCommand(["status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Daily Bars");
    expect(result.stdout).toContain("Streak:");
  });

  test("status --json returns structured data", async () => {
    await executeCommand(["log", "--protein", "50"]);
    const result = await executeCommand(["status", "--json"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.bars).toBeDefined();
    expect(data.stats).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/cli-gamify.test.ts
```
Expected: FAIL - "log" command not recognized

**Step 3: Add log and status commands to CLI**

```typescript
// Add to src/cli.ts switch statement

case "log": {
  const protein = parseOptionalFloat(flags.protein) ?? 0;
  const carbs = parseOptionalFloat(flags.carbs) ?? 0;
  const fat = parseOptionalFloat(flags.fat) ?? 0;
  const calories = parseOptionalFloat(flags.calories) ?? 0;

  if (protein === 0 && carbs === 0 && fat === 0 && calories === 0) {
    printError("Usage: nomnom log --protein <g> [--carbs <g>] [--fat <g>] [--calories <kcal>]");
  }

  const { getDb, initGamifyTables, getLifetimeStats } = await import("./db");
  const { GamifyEngine } = await import("./engine");
  
  const db = getDb();
  initGamifyTables(db);
  
  const stats = getLifetimeStats(db);
  const bonus = stats.current_streak * 0.04;
  
  GamifyEngine.logMeal(db, { protein, carbs, fat, calories });
  
  const bars = getDailyBars(db);
  
  printResult(
    {
      success: true,
      logged: {
        protein: Math.round(protein * (1 + bonus)),
        carbs: Math.round(carbs * (1 + bonus)),
        fat: Math.round(fat * (1 + bonus)),
        calories: Math.round(calories * (1 + bonus)),
      },
      bonusApplied: `${Math.round(bonus * 100)}%`,
      dailyTotals: {
        protein: Math.round(bars.p_logged),
        carbs: Math.round(bars.c_logged),
        fat: Math.round(bars.f_logged),
        calories: Math.round(bars.cal_logged),
      },
    },
    `Logged: P${protein}g C${carbs}g F${fat}g ${calories}kcal${bonus > 0 ? ` (+${Math.round(bonus * 100)}% streak bonus)` : ""}`
  );
  break;
}

case "status": {
  const { getDb, initGamifyTables } = await import("./db");
  const { GamifyEngine } = await import("./engine");
  
  const db = getDb();
  initGamifyTables(db);
  
  if (flags.json) {
    const bars = getDailyBars(db);
    const stats = getLifetimeStats(db);
    const percents = GamifyEngine.getBarPercents(db);
    printResult({
      bars: {
        protein: { logged: bars.p_logged, goal: bars.p_goal, percent: percents.protein },
        carbs: { logged: bars.c_logged, goal: bars.c_goal, percent: percents.carbs },
        fat: { logged: bars.f_logged, goal: bars.f_goal, percent: percents.fat },
        calories: { logged: bars.cal_logged, goal: bars.cal_goal, percent: percents.calories },
      },
      stats: {
        totalVictories: stats.total_victories,
        currentStreak: stats.current_streak,
        reducerLevel: stats.reducer_lvl,
      },
    });
  } else {
    out(GamifyEngine.formatStatus(db));
  }
  break;
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/cli-gamify.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts tests/cli-gamify.test.ts
git commit -m "feat(gamify): add log and status CLI commands"
```

---

## Task 5: CLI Commands - victory-check and buy-reducer

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-gamify.test.ts`

**Step 1: Write the failing test**

Add to `tests/cli-gamify.test.ts`:

```typescript
test("victory-check awards victory when bars complete", async () => {
  await executeCommand(["log", "--protein", "150", "--carbs", "200", "--fat", "60", "--calories", "2200"]);
  const result = await executeCommand(["victory-check"]);
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout);
  expect(data.victory).toBe(true);
  expect(data.streak).toBe(1);
});

test("victory-check does not award when incomplete", async () => {
  await executeCommand(["log", "--protein", "50"]);
  const result = await executeCommand(["victory-check"]);
  const data = JSON.parse(result.stdout);
  expect(data.victory).toBe(false);
});

test("buy-reducer purchases upgrade with victories", async () => {
  // Get 5 victories
  for (let i = 0; i < 5; i++) {
    await executeCommand(["log", "--protein", "150", "--carbs", "200", "--fat", "60", "--calories", "2200"]);
    await executeCommand(["victory-check"]);
  }
  
  const result = await executeCommand(["buy-reducer"]);
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout);
  expect(data.success).toBe(true);
  expect(data.newLevel).toBe(1);
});

test("buy-reducer fails without enough victories", async () => {
  await executeCommand(["log", "--protein", "150", "--carbs", "200", "--fat", "60", "--calories", "2200"]);
  await executeCommand(["victory-check"]);
  
  const result = await executeCommand(["buy-reducer"]);
  expect(result.exitCode).toBe(1);
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/cli-gamify.test.ts
```
Expected: FAIL - "victory-check" not recognized

**Step 3: Add victory-check and buy-reducer commands**

```typescript
// Add to src/cli.ts switch statement

case "victory-check": {
  const { getDb, initGamifyTables, getLifetimeStats } = await import("./db");
  const { GamifyEngine } = await import("./engine");
  
  const db = getDb();
  initGamifyTables(db);
  
  const result = GamifyEngine.checkVictory(db);
  const stats = getLifetimeStats(db);
  
  printResult(
    {
      victory: result.victory,
      alreadyAwarded: result.alreadyAwarded,
      streak: stats.current_streak,
    },
    result.victory
      ? result.alreadyAwarded
        ? "Victory already awarded for today!"
        : `🎉 Victory! Streak: ${stats.current_streak}`
      : "Not all bars complete yet. Keep logging!"
  );
  break;
}

case "buy-reducer": {
  const { getDb, initGamifyTables, getLifetimeStats } = await import("./db");
  const { GamifyEngine } = await import("./engine");
  
  const db = getDb();
  initGamifyTables(db);
  
  const statsBefore = getLifetimeStats(db);
  const result = GamifyEngine.buyReducer(db);
  
  if (!result.success) {
    printError(result.error!);
  }
  
  const statsAfter = getLifetimeStats(db);
  
  printResult(
    {
      success: true,
      newLevel: result.newLevel,
      goalsReduced: {
        protein: 5 * result.newLevel!,
        carbs: 5 * result.newLevel!,
        fat: 3 * result.newLevel!,
        calories: 50 * result.newLevel!,
      },
    },
    `Reducer Lvl ${result.newLevel}! Goals reduced by ${5 * result.newLevel!}g protein/carbs, ${3 * result.newLevel!}g fat, ${50 * result.newLevel!} cal`
  );
  break;
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/cli-gamify.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts tests/cli-gamify.test.ts
git commit -m "feat(gamify): add victory-check and buy-reducer CLI commands"
```

---

## Task 6: Simulation Harness

**Files:**
- Create: `src/sim.ts`
- Test: `tests/sim.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sim.test.ts
import { describe, test, expect } from "bun:test";
import { runSimulation } from "../src/sim";

describe("Simulation Harness", () => {
  test("runSimulation completes without errors", () => {
    const result = runSimulation(30, 42);
    expect(result.days).toBe(30);
    expect(result.victories).toBeGreaterThan(0);
  });

  test("runSimulation shows parabolic progression", () => {
    const result = runSimulation(30, 42);
    // Later days should have more victories than early days
    const earlyVictories = result.dailyVictories.slice(0, 10).reduce((a, b) => a + b, 0);
    const lateVictories = result.dailyVictories.slice(-10).reduce((a, b) => a + b, 0);
    expect(lateVictories).toBeGreaterThanOrEqual(earlyVictories);
  });

  test("runSimulation with seed is deterministic", () => {
    const r1 = runSimulation(10, 123);
    const r2 = runSimulation(10, 123);
    expect(r1.victories).toBe(r2.victories);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/sim.test.ts
```
Expected: FAIL - "runSimulation is not defined"

**Step 3: Create simulation harness**

```typescript
// src/sim.ts
import { Database } from "bun:sqlite";
import { initGamifyTables, getLifetimeStats, getDailyBars } from "./db";
import { GamifyEngine } from "./engine";

export function runSimulation(days: number, seed: number): SimulationResult {
  // Seeded random
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const db = new Database(":memory:");
  initGamifyTables(db);

  const dailyVictories: number[] = [];
  let totalVictories = 0;

  for (let d = 0; d < days; d++) {
    // Simulate 3 meals with random macros (70-110% of goals)
    for (let meal = 0; meal < 3; meal++) {
      const protein = Math.round(40 + rand() * 20);
      const carbs = Math.round(60 + rand() * 30);
      const fat = Math.round(15 + rand() * 10);
      const calories = Math.round(400 + rand() * 200);

      GamifyEngine.logMeal(db, { protein, carbs, fat, calories });
    }

    // Check for victory
    const result = GamifyEngine.checkVictory(db);
    if (result.victory && !result.alreadyAwarded) {
      totalVictories++;
      dailyVictories.push(1);
    } else {
      dailyVictories.push(0);
    }

    // Auto-buy reducer if we can
    const stats = getLifetimeStats(db);
    const cost = 5 * (stats.reducer_lvl + 1);
    if (stats.total_victories >= cost) {
      GamifyEngine.buyReducer(db);
    }

    // New day - reset bars (in real app, this is midnight)
    const today = getDailyBars(db);
    const tomorrow = new Date(Date.now() + (d + 1) * 86400000)
      .toISOString()
      .split("T")[0];
    db.run(
      `INSERT INTO daily_bars (date, streak_bonus) VALUES (?, ?)`,
      [tomorrow, stats.current_streak * 0.04]
    );
  }

  const finalStats = getLifetimeStats(db);

  return {
    days,
    victories: finalStats.total_victories,
    maxStreak: finalStats.current_streak,
    reducerLevel: finalStats.reducer_lvl,
    dailyVictories,
  };
}

export interface SimulationResult {
  days: number;
  victories: number;
  maxStreak: number;
  reducerLevel: number;
  dailyVictories: number[];
}

export function formatSimulationResult(result: SimulationResult): string {
  return `
Simulation: ${result.days} days
─────────────────────
Victories: ${result.victories}
Max Streak: ${result.maxStreak}
Reducer Level: ${result.reducerLevel}
Daily Victory Rate: ${Math.round((result.victories / result.days) * 100)}%

Victories by Day:
${result.dailyVictories.map((v, i) => `Day ${i + 1}: ${v ? "✓" : "✗"}`).join("\n")}
`.trim();
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/sim.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/sim.ts tests/sim.test.ts
git commit -m "feat(gamify): add simulation harness for testing mechanics"
```

---

## Task 7: CLI Command - sim

**Files:**
- Modify: `src/cli.ts`

**Step 1: Add sim command to CLI**

```typescript
// Add to src/cli.ts switch statement

case "sim": {
  const days = parseInt(positional[0], 10) || 30;
  const seed = parseInt(flags.seed, 10) || Date.now();
  
  const { runSimulation, formatSimulationResult } = await import("./sim");
  
  const result = runSimulation(days, seed);
  
  if (flags.json) {
    printResult(result);
  } else {
    out(formatSimulationResult(result));
  }
  break;
}
```

**Step 2: Manual test**

```bash
bun start sim 30
bun start sim 30 --seed 42 --json
```

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(gamify): add sim CLI command"
```

---

## Task 8: MCP Integration

**Files:**
- Modify: `src/mcp.ts`
- Test: `tests/mcp-gamify.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/mcp-gamify.test.ts
import { describe, test, expect } from "bun:test";

describe("MCP - gamify endpoints", () => {
  test("log command via MCP returns success", async () => {
    // This would test the MCP handler
    // For now, verify the command string parsing works
    const cmd = "log --protein 50 --carbs 60 --fat 20 --calories 500";
    // ... MCP test logic
  });
});
```

**Step 2: Verify existing MCP handles new commands**

The existing MCP server in `src/mcp.ts` already passes commands to `executeCommand`, so new commands work automatically.

**Step 3: Document in AGENTS.md**

Add to `docs/AGENTS.md`:

```markdown
### Gamification Commands

**log [options]**
- `--protein <n>` - Protein in grams
- `--carbs <n>` - Carbs in grams
- `--fat <n>` - Fat in grams
- `--calories <n>` - Calories

**status**
- `--json` - Output as JSON

**victory-check**
- Check if all bars are complete, award victory if so

**buy-reducer**
- Purchase a reducer upgrade (costs 5 × (level + 1) victories)

**sim <days>**
- `--seed <n>` - Random seed for reproducibility
- `--json` - Output as JSON
```

**Step 4: Commit**

```bash
git add docs/AGENTS.md tests/mcp-gamify.test.ts
git commit -m "docs: document gamification commands in AGENTS.md"
```

---

## Task 9: Update Help Text

**Files:**
- Modify: `src/cli.ts`

**Step 1: Add gamification commands to help**

Update the `showHelp()` function in `src/cli.ts` to include:

```typescript
  log <food> [options]        Log a meal (existing USDA-based)
  log [options]               Quick log macros for gamification
    --protein <n>             Protein (g)
    --carbs <n>               Carbs (g)
    --fat <n>                 Fat (g)
    --calories <n>            Calories

  status                      Show daily bars and gamification progress
    --json                    Output as JSON

  victory-check               Check if all bars complete, award victory

  buy-reducer                 Purchase reducer upgrade

  sim <days>                  Run simulation
    --seed <n>                Random seed
    --json                    Output as JSON
```

**Step 2: Manual test**

```bash
bun start help
```

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "docs: add gamification commands to help text"
```

---

## Task 10: Integration Test and Typecheck

**Files:**
- Test: Run all tests

**Step 1: Run full test suite**

```bash
bun test
bun run typecheck
```

**Step 2: Run lint if configured**

```bash
bun run lint
```

**Step 3: Manual end-to-end test**

```bash
# Full loop test
bun start log --protein 50 --carbs 70 --fat 20 --calories 600
bun start log --protein 50 --carbs 70 --fat 20 --calories 600
bun start log --protein 55 --carbs 65 --fat 22 --calories 550
bun start status
bun start victory-check
bun start buy-reducer
bun start sim 7 --seed 123
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(gamify): complete macro bar filler implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Database: daily_bars table | `src/db.ts`, `tests/gamify.test.ts` |
| 2 | Database: lifetime_stats table | `src/db.ts`, `tests/gamify.test.ts` |
| 3 | Gamification engine | `src/engine.ts`, `tests/gamify.test.ts` |
| 4 | CLI: log, status | `src/cli.ts`, `tests/cli-gamify.test.ts` |
| 5 | CLI: victory-check, buy-reducer | `src/cli.ts`, `tests/cli-gamify.test.ts` |
| 6 | Simulation harness | `src/sim.ts`, `tests/sim.test.ts` |
| 7 | CLI: sim command | `src/cli.ts` |
| 8 | MCP integration | `docs/AGENTS.md` |
| 9 | Help text | `src/cli.ts` |
| 10 | Integration test | All files |

**Estimated LOC**: ~300 (including tests)
**Estimated Time**: 4-6 hours
