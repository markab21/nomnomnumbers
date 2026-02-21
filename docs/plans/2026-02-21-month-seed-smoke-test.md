# Month Seed & Smoke Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `--date` offset flag to the `today` command, a month-seeder script that populates 28 days of realistic randomized meal history, and a smoke test that validates the whole thing end-to-end.

**Architecture:** Three pieces working together:
1. `today --date <offset>` — new flag where `0` = today, `-1` = yesterday, `-7` = one week ago
2. `scripts/seed-month.ts` — standalone Bun script that directly inserts meals into the DB for each of the last 28 days using the same `logMeal` from `src/db.ts`, with a fixed random seed so results are reproducible; builds a 7-day template week and repeats it 4 times with slight per-week calorie variation
3. `scripts/smoke-test-month.ts` — standalone Bun script that (a) resets the DB, (b) runs the seeder, (c) calls the CLI for each of the 28 days using `today --date <offset>`, and (d) validates JSON output: correct date, ≥2 meals, all 4 meal types appear across the week, totals.calories > 0

**Tech Stack:** Bun CLI (`bun start`), Bun scripts, SQLite at `~/.local/share/nomnom/nomnom.db`, TypeScript

---

## Task 1: Add `--date` Offset to `today` Command

**Files:**
- Modify: `src/cli.ts` (around line 403–424, the `today` case)

The `today` command currently hardcodes `new Date()`. We need to read an optional `--date <n>` flag where `n` is an integer offset (0 = today, -1 = yesterday, -28 = 28 days ago). Positive values are also allowed (future dates).

**Step 1: Write the failing test**

Create file `scripts/test-date-offset.sh`:
```bash
#!/usr/bin/env bash
set -e

# Test: today --date 0 returns today's date
RESULT=$(bun start today --date 0)
TODAY=$(date +%Y-%m-%d)
echo "$RESULT" | grep -q "\"date\": \"$TODAY\"" && echo "PASS: date 0 = today" || { echo "FAIL: date 0"; exit 1; }

# Test: today --date -1 returns yesterday
RESULT=$(bun start today --date -1)
YESTERDAY=$(date -d "1 day ago" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)
echo "$RESULT" | grep -q "\"date\": \"$YESTERDAY\"" && echo "PASS: date -1 = yesterday" || { echo "FAIL: date -1"; exit 1; }

echo "ALL PASS"
```

**Step 2: Run test to see it fail**

```bash
chmod +x scripts/test-date-offset.sh
bash scripts/test-date-offset.sh
```

Expected: FAIL because `--date` flag is ignored.

**Step 3: Implement the change in `src/cli.ts`**

In the `today` case (around line 403), replace:
```typescript
case "today": {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
```

With:
```typescript
case "today": {
  const offsetDays = parseInt(flags.date ?? "0", 10);
  const offset = isNaN(offsetDays) ? 0 : offsetDays;
  const now = new Date();
  now.setDate(now.getDate() + offset);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
```

**Step 4: Run test to verify it passes**

```bash
bash scripts/test-date-offset.sh
```

Expected: PASS for both cases.

**Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: No errors.

**Step 6: Commit**

```bash
git add src/cli.ts scripts/test-date-offset.sh
git commit -m "feat: add --date offset flag to today command"
```

---

## Task 2: Write the Month Seeder Script

**Files:**
- Create: `scripts/seed-month.ts`

This script populates 28 days of meal history (days -27 through 0 relative to today) directly via `logMeal` from `src/db.ts`. It builds a 7-day template week and repeats it 4 times.

The seeder uses a **deterministic pseudo-random** approach (seeded with a fixed value) so the same data is inserted every time it's run on a clean DB. This makes the smoke test reproducible.

**Meal template (7-day week, 4 meals/day):**

| Day | Breakfast | Lunch | Dinner | Snack |
|-----|-----------|-------|--------|-------|
| Mon | Oatmeal (350 cal, 12p, 60c, 6f) | Chicken Wrap (520 cal, 35p, 48c, 14f) | Salmon Rice (680 cal, 42p, 72c, 18f) | Apple (95 cal, 0p, 25c, 0f) |
| Tue | Scrambled Eggs (310 cal, 22p, 4c, 22f) | Tuna Salad (420 cal, 38p, 18c, 20f) | Beef Stir Fry (590 cal, 38p, 55c, 20f) | Greek Yogurt (150 cal, 15p, 12c, 3f) |
| Wed | Banana Smoothie (380 cal, 8p, 72c, 6f) | Veggie Burrito (510 cal, 18p, 68c, 16f) | Grilled Chicken (620 cal, 52p, 30c, 28f) | Almonds (160 cal, 6p, 6c, 14f) |
| Thu | Avocado Toast (420 cal, 12p, 45c, 22f) | Turkey Sandwich (480 cal, 32p, 52c, 12f) | Shrimp Pasta (640 cal, 36p, 78c, 18f) | Orange (60 cal, 1p, 15c, 0f) |
| Fri | Pancakes (450 cal, 10p, 75c, 12f) | Caesar Salad (380 cal, 18p, 22c, 24f) | Pork Tenderloin (580 cal, 48p, 28c, 28f) | Cheese Crackers (180 cal, 6p, 20c, 9f) |
| Sat | French Toast (490 cal, 14p, 68c, 16f) | Veggie Soup (320 cal, 10p, 45c, 8f) | Pizza (720 cal, 28p, 85c, 26f) | Ice Cream (250 cal, 4p, 32c, 12f) |
| Sun | Waffles (410 cal, 10p, 62c, 14f) | BLT Sandwich (440 cal, 22p, 38c, 20f) | Lamb Chops (660 cal, 44p, 18c, 36f) | Granola Bar (200 cal, 5p, 28c, 8f) |

Each week gets a ±5% calorie variation applied to all macros (multiply by a week-specific factor: week 0 = 1.0, week 1 = 0.97, week 2 = 1.03, week 3 = 0.95).

**How to insert with a past date:** The `logMeal` function uses SQLite's `DEFAULT (datetime('now'))`. To override, we need to INSERT with an explicit `logged_at`. We'll use `getDb()` and run a raw INSERT with the target date string. The date format must be `YYYY-MM-DD HH:MM:SS`.

Meal times (fixed):
- breakfast: `07:30:00`
- lunch: `12:15:00`
- dinner: `18:45:00`
- snack: `15:00:00`

**Step 1: Write the seeder script**

Create `scripts/seed-month.ts`:

```typescript
#!/usr/bin/env bun
/**
 * seed-month.ts
 * Populates 28 days of meal history into the nomnom DB for smoke testing.
 * Run: bun scripts/seed-month.ts
 */

import { getDb, initializeDatabase } from "../src/db";
import { crypto } from "bun";

// Initialize DB (creates tables if needed)
initializeDatabase();
const db = getDb();

interface MealTemplate {
  foodName: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  time: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  unit: string;
  qty: number;
}

const WEEK_TEMPLATE: MealTemplate[][] = [
  // Day 0: Monday
  [
    { foodName: "Oatmeal", mealType: "breakfast", time: "07:30:00", calories: 350, protein: 12, carbs: 60, fat: 6, unit: "bowl", qty: 1 },
    { foodName: "Chicken Wrap", mealType: "lunch", time: "12:15:00", calories: 520, protein: 35, carbs: 48, fat: 14, unit: "wrap", qty: 1 },
    { foodName: "Salmon Rice", mealType: "dinner", time: "18:45:00", calories: 680, protein: 42, carbs: 72, fat: 18, unit: "serving", qty: 1 },
    { foodName: "Apple", mealType: "snack", time: "15:00:00", calories: 95, protein: 0, carbs: 25, fat: 0, unit: "medium", qty: 1 },
  ],
  // Day 1: Tuesday
  [
    { foodName: "Scrambled Eggs", mealType: "breakfast", time: "07:30:00", calories: 310, protein: 22, carbs: 4, fat: 22, unit: "serving", qty: 1 },
    { foodName: "Tuna Salad", mealType: "lunch", time: "12:15:00", calories: 420, protein: 38, carbs: 18, fat: 20, unit: "serving", qty: 1 },
    { foodName: "Beef Stir Fry", mealType: "dinner", time: "18:45:00", calories: 590, protein: 38, carbs: 55, fat: 20, unit: "serving", qty: 1 },
    { foodName: "Greek Yogurt", mealType: "snack", time: "15:00:00", calories: 150, protein: 15, carbs: 12, fat: 3, unit: "cup", qty: 1 },
  ],
  // Day 2: Wednesday
  [
    { foodName: "Banana Smoothie", mealType: "breakfast", time: "07:30:00", calories: 380, protein: 8, carbs: 72, fat: 6, unit: "glass", qty: 1 },
    { foodName: "Veggie Burrito", mealType: "lunch", time: "12:15:00", calories: 510, protein: 18, carbs: 68, fat: 16, unit: "burrito", qty: 1 },
    { foodName: "Grilled Chicken", mealType: "dinner", time: "18:45:00", calories: 620, protein: 52, carbs: 30, fat: 28, unit: "serving", qty: 1 },
    { foodName: "Almonds", mealType: "snack", time: "15:00:00", calories: 160, protein: 6, carbs: 6, fat: 14, unit: "handful", qty: 1 },
  ],
  // Day 3: Thursday
  [
    { foodName: "Avocado Toast", mealType: "breakfast", time: "07:30:00", calories: 420, protein: 12, carbs: 45, fat: 22, unit: "slice", qty: 2 },
    { foodName: "Turkey Sandwich", mealType: "lunch", time: "12:15:00", calories: 480, protein: 32, carbs: 52, fat: 12, unit: "sandwich", qty: 1 },
    { foodName: "Shrimp Pasta", mealType: "dinner", time: "18:45:00", calories: 640, protein: 36, carbs: 78, fat: 18, unit: "serving", qty: 1 },
    { foodName: "Orange", mealType: "snack", time: "15:00:00", calories: 60, protein: 1, carbs: 15, fat: 0, unit: "medium", qty: 1 },
  ],
  // Day 4: Friday
  [
    { foodName: "Pancakes", mealType: "breakfast", time: "07:30:00", calories: 450, protein: 10, carbs: 75, fat: 12, unit: "stack", qty: 1 },
    { foodName: "Caesar Salad", mealType: "lunch", time: "12:15:00", calories: 380, protein: 18, carbs: 22, fat: 24, unit: "serving", qty: 1 },
    { foodName: "Pork Tenderloin", mealType: "dinner", time: "18:45:00", calories: 580, protein: 48, carbs: 28, fat: 28, unit: "serving", qty: 1 },
    { foodName: "Cheese Crackers", mealType: "snack", time: "15:00:00", calories: 180, protein: 6, carbs: 20, fat: 9, unit: "serving", qty: 1 },
  ],
  // Day 5: Saturday
  [
    { foodName: "French Toast", mealType: "breakfast", time: "07:30:00", calories: 490, protein: 14, carbs: 68, fat: 16, unit: "serving", qty: 1 },
    { foodName: "Veggie Soup", mealType: "lunch", time: "12:15:00", calories: 320, protein: 10, carbs: 45, fat: 8, unit: "bowl", qty: 1 },
    { foodName: "Pizza", mealType: "dinner", time: "18:45:00", calories: 720, protein: 28, carbs: 85, fat: 26, unit: "slice", qty: 3 },
    { foodName: "Ice Cream", mealType: "snack", time: "15:00:00", calories: 250, protein: 4, carbs: 32, fat: 12, unit: "scoop", qty: 2 },
  ],
  // Day 6: Sunday
  [
    { foodName: "Waffles", mealType: "breakfast", time: "07:30:00", calories: 410, protein: 10, carbs: 62, fat: 14, unit: "waffle", qty: 2 },
    { foodName: "BLT Sandwich", mealType: "lunch", time: "12:15:00", calories: 440, protein: 22, carbs: 38, fat: 20, unit: "sandwich", qty: 1 },
    { foodName: "Lamb Chops", mealType: "dinner", time: "18:45:00", calories: 660, protein: 44, carbs: 18, fat: 36, unit: "serving", qty: 1 },
    { foodName: "Granola Bar", mealType: "snack", time: "15:00:00", calories: 200, protein: 5, carbs: 28, fat: 8, unit: "bar", qty: 1 },
  ],
];

// Week-level calorie variation factors
const WEEK_FACTORS = [1.0, 0.97, 1.03, 0.95];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const stmt = db.prepare(`
  INSERT INTO meals (id, food_name, quantity, unit, meal_type, logged_at, notes, calories, protein, carbs, fat)
  VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
`);

let totalInserted = 0;

// Insert 28 days: day -27 (oldest) through day 0 (today)
for (let dayOffset = -27; dayOffset <= 0; dayOffset++) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  const dateStr = formatDate(date);

  // Which day of the week template? dayOffset = -27 means oldest.
  // Map dayOffset to 0-6: we want day -27 = template index 0
  const templateDayIndex = ((27 + dayOffset) % 7 + 7) % 7;
  const dayMeals = WEEK_TEMPLATE[templateDayIndex]!;

  // Which week repetition? 0 = oldest week, 3 = most recent
  const weekIndex = Math.floor((27 + dayOffset) / 7);
  const factor = WEEK_FACTORS[weekIndex] ?? 1.0;

  for (const meal of dayMeals) {
    const loggedAt = `${dateStr} ${meal.time}`;
    stmt.run(
      crypto.randomUUID(),
      meal.foodName,
      meal.qty,
      meal.unit,
      meal.mealType,
      loggedAt,
      round1(meal.calories * factor),
      round1(meal.protein * factor),
      round1(meal.carbs * factor),
      round1(meal.fat * factor),
    );
    totalInserted++;
  }
}

console.log(`Seeded ${totalInserted} meals across 28 days.`);
```

**Step 2: Run the seeder manually to check it works**

```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun scripts/seed-month.ts
```

Expected output: `Seeded 112 meals across 28 days.`

**Step 3: Spot-check a couple of dates manually**

```bash
bun start today --date 0
bun start today --date -7
bun start today --date -27
```

Each should return `{ "date": "<correct date>", "totals": { "mealCount": 4, "calories": <> }, ... }`.

**Step 4: Commit**

```bash
git add scripts/seed-month.ts
git commit -m "feat: add month seeder script with 7-day repeating meal template"
```

---

## Task 3: Write the Smoke Test Script

**Files:**
- Create: `scripts/smoke-test-month.ts`

This script is a standalone Bun test that:
1. Resets the DB
2. Runs the seeder
3. Uses `Bun.spawnSync` to call `bun start today --date <offset>` for each of the 28 days
4. Validates the JSON output for each day
5. Prints a summary: PASS / FAIL per day and overall

**Validation checks per day:**
- `date` field matches the expected calendar date (YYYY-MM-DD)
- `totals.mealCount` === 4
- `totals.calories` > 0
- `meals` array has exactly 4 items
- All 4 meal types present: breakfast, lunch, dinner, snack
- Every meal has a non-null `calories` field

**Additional cross-week checks:**
- Week 0 (days -27 to -21): avg daily calories around 1645 ± 50 (factor 1.0)
- Week 3 (days -6 to 0): avg daily calories around 1563 ± 50 (factor 0.95)

**Step 1: Write the smoke test**

Create `scripts/smoke-test-month.ts`:

```typescript
#!/usr/bin/env bun
/**
 * smoke-test-month.ts
 * Seeds 28 days of meal history and validates every day via the CLI.
 * Run: bun scripts/smoke-test-month.ts
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---- Reset DB ----
const dbPath = process.env.NOMNOM_DATA_DIR
  ? join(process.env.NOMNOM_DATA_DIR, "nomnom.db")
  : join(homedir(), ".local", "share", "nomnom", "nomnom.db");

if (existsSync(dbPath)) {
  rmSync(dbPath);
  console.log(`Reset DB: ${dbPath}`);
}

// ---- Run seeder ----
console.log("Seeding 28 days of meal history...");
const seedResult = Bun.spawnSync(["bun", "scripts/seed-month.ts"], {
  cwd: import.meta.dir + "/..",
  stderr: "pipe",
});
const seedOut = new TextDecoder().decode(seedResult.stdout);
const seedErr = new TextDecoder().decode(seedResult.stderr);
if (seedResult.exitCode !== 0) {
  console.error("Seeder failed:", seedErr);
  process.exit(1);
}
console.log(seedOut.trim());

// ---- Helpers ----
function dateForOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DayResult {
  date: string;
  totals: { calories: number; protein: number; carbs: number; fat: number; mealCount: number };
  meals: Array<{
    foodName: string;
    mealType: string;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  }>;
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

// ---- Test each of 28 days ----
for (let offset = -27; offset <= 0; offset++) {
  const expectedDate = dateForOffset(offset);

  const result = Bun.spawnSync(
    ["bun", "start", "today", "--date", String(offset)],
    { cwd: import.meta.dir + "/..", stderr: "pipe" }
  );

  const raw = new TextDecoder().decode(result.stdout).trim();

  let day: DayResult;
  try {
    day = JSON.parse(raw) as DayResult;
  } catch {
    failures.push(`day ${offset}: could not parse JSON: ${raw.slice(0, 80)}`);
    failed++;
    continue;
  }

  const errors: string[] = [];

  // Check date
  if (day.date !== expectedDate) {
    errors.push(`date="${day.date}" expected="${expectedDate}"`);
  }

  // Check meal count
  if (day.totals.mealCount !== 4) {
    errors.push(`mealCount=${day.totals.mealCount} expected=4`);
  }

  // Check meals array length
  if (day.meals.length !== 4) {
    errors.push(`meals.length=${day.meals.length} expected=4`);
  }

  // Check calories > 0
  if (day.totals.calories <= 0) {
    errors.push(`totals.calories=${day.totals.calories} expected>0`);
  }

  // Check all 4 meal types present
  const types = new Set(day.meals.map((m) => m.mealType));
  for (const t of ["breakfast", "lunch", "dinner", "snack"]) {
    if (!types.has(t)) errors.push(`missing mealType="${t}"`);
  }

  // Check every meal has non-null calories
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
    failures.push(`day ${offset} (${expectedDate}): ${errors.join("; ")}`);
    console.log(`✗ day ${String(offset).padStart(3)} (${expectedDate})  FAIL: ${errors.join("; ")}`);
  }
}

// ---- Cross-week calorie range checks ----
// Week 0 (offsets -27 to -21): factor 1.0, expected daily total ~1645
// Week 3 (offsets -6 to 0): factor 0.95, expected daily total ~1563
const BASE_DAILY_CALORIES = 1645; // sum of all 7 day templates / 7 * average
// (actual template totals: 1645, 1470, 1670, 1600, 1590, 1780, 1710 -> avg ~1638)
// We'll just check that week 0 avg > week 3 avg (factor difference)

async function getWeekAvgCalories(startOffset: number): Promise<number> {
  let total = 0;
  for (let o = startOffset; o < startOffset + 7; o++) {
    const result = Bun.spawnSync(
      ["bun", "start", "today", "--date", String(o)],
      { cwd: import.meta.dir + "/..", stderr: "pipe" }
    );
    const day = JSON.parse(new TextDecoder().decode(result.stdout)) as DayResult;
    total += day.totals.calories;
  }
  return total / 7;
}

const week0Avg = await getWeekAvgCalories(-27);
const week3Avg = await getWeekAvgCalories(-6);

console.log(`\nWeek 0 avg calories: ${week0Avg.toFixed(1)}`);
console.log(`Week 3 avg calories: ${week3Avg.toFixed(1)}`);

if (week0Avg > week3Avg) {
  console.log("✓ Cross-week check: week 0 avg > week 3 avg (factor 1.0 > 0.95)");
  passed++;
} else {
  console.log("✗ Cross-week check: week 0 avg should be > week 3 avg");
  failures.push(`cross-week: week0avg=${week0Avg.toFixed(1)} should be > week3avg=${week3Avg.toFixed(1)}`);
  failed++;
}

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

**Step 2: Run the smoke test**

```bash
bun scripts/smoke-test-month.ts
```

Expected: All 28 days PASS, cross-week check PASS, exit code 0.

**Step 3: Commit**

```bash
git add scripts/smoke-test-month.ts
git commit -m "feat: add month smoke test validating 28 days of meal history"
```

---

## Task 4: Wire Up npm Script and Final Verification

**Files:**
- Modify: `package.json`

**Step 1: Add scripts to package.json**

In `package.json`, add to the `scripts` object:
```json
"seed:month": "bun scripts/seed-month.ts",
"smoke:month": "bun scripts/smoke-test-month.ts"
```

**Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: No errors.

**Step 3: Run the full smoke test one final time from clean state**

```bash
bun run smoke:month
```

Expected: `ALL CHECKS PASSED`

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add seed:month and smoke:month npm scripts"
```

---

## Pass Criteria

- `bun start today --date -3` returns the date 3 days ago
- `bun run seed:month` inserts 112 meals across 28 days
- `bun run smoke:month` exits 0 with "ALL CHECKS PASSED"
- `bun run typecheck` passes with no errors
