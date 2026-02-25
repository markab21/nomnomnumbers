# Agent Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three agent-facing features to NomNom Numbers: a `trends` command, `--offset` pagination for `history`, and unified goals in the `today` output.

**Architecture:** New `getTrendData()` function in `db.ts` computes daily totals over a date range. `getMealHistory()` gains an `offset` parameter. The `today` CLI handler queries gamification goals from `daily_bars` to populate `remaining`. All changes are additive; no existing behavior changes.

**Tech Stack:** Bun, SQLite (bun:sqlite), TypeScript

**Design Doc:** `docs/plans/2026-02-23-agent-features-design.md`

---

## Task 1: Add `--offset` to `getMealHistory()`

**Files:**
- Modify: `src/db.ts:770-807` (`getMealHistory` function)
- Test: `scripts/test-agent-features.ts` (new)

**Step 1: Write the failing test**

```typescript
// scripts/test-agent-features.ts
import { Database } from "bun:sqlite";

// ---- Offset pagination test ----
// We test by importing and calling getMealHistory with offset
// First, verify the function signature accepts offset

import { logMeal, getMealHistory, initializeDatabase } from "../src/db";

// Initialize
initializeDatabase();

// Log 5 meals
for (let i = 1; i <= 5; i++) {
  logMeal({ foodName: `Food ${i}`, quantity: 1, calories: 100 * i });
}

// Test: offset=0 returns first batch
const first2 = getMealHistory(2, 0);
console.assert(first2.length === 2, `Expected 2 meals, got ${first2.length}`);

// Test: offset=2 returns next batch
const next2 = getMealHistory(2, 2);
console.assert(next2.length === 2, `Expected 2 meals with offset, got ${next2.length}`);

// Test: offset meals should be different from first batch
console.assert(first2[0].id !== next2[0].id, "Offset meals should differ from first batch");

// Test: offset=4 returns 1 (only 5 total)
const last = getMealHistory(2, 4);
console.assert(last.length === 1, `Expected 1 meal at offset 4, got ${last.length}`);

// Test: offset beyond count returns empty
const empty = getMealHistory(2, 10);
console.assert(empty.length === 0, `Expected 0 meals at offset 10, got ${empty.length}`);

console.log("✅ Offset pagination tests passed");
```

**Step 2: Run test to verify it fails**

```bash
bun run scripts/test-agent-features.ts
```
Expected: FAIL — `getMealHistory` does not accept second argument (or doesn't use it)

**Step 3: Add offset parameter to getMealHistory**

In `src/db.ts`, modify `getMealHistory`:

```typescript
export function getMealHistory(limit: number = 20, offset: number = 0): MealResult[] {
  const db = getDb();
  const stmt = db.query(`
    SELECT id, food_name, quantity, unit, meal_type, logged_at, notes,
           calories, protein, carbs, fat
    FROM meals
    ORDER BY logged_at DESC
    LIMIT ?
    OFFSET ?
  `);

  const rows = stmt.all(limit, offset) as Array<{
    // ... same type as before
  }>;

  // ... same mapping as before
}
```

**Step 4: Run test to verify it passes**

```bash
bun run scripts/test-agent-features.ts
```
Expected: PASS — "✅ Offset pagination tests passed"

**Step 5: Commit**

```bash
git add src/db.ts scripts/test-agent-features.ts
git commit -m "feat: add offset parameter to getMealHistory"
```

---

## Task 2: Add `--offset` flag to CLI `history` handler

**Files:**
- Modify: `src/cli.ts:645-661` (`case "history"` block)

**Step 1: Modify the history CLI handler**

In `src/cli.ts`, update the `case "history"` block:

```typescript
case "history": {
  const limit = parsePositiveInt(flags.limit, 20, 500);
  const offset = parsePositiveInt(flags.offset, 0, 10000);
  const meals = getMealHistory(limit, offset);
  printResult(
    { count: meals.length, offset, meals: meals.map(formatMeal) },
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
```

Note: `parsePositiveInt` accepts 0 as valid since it clamps to `max`. We set max to 10000 to prevent abuse.

**Step 2: Update help text**

In `showHelp()`, update the history section:

```
  history [options]           Show meal history
    --limit <n>               Max results (default: 20)
    --offset <n>              Skip first N results (default: 0)
```

**Step 3: Manual test**

```bash
# Log a few items first, then:
bun start history --limit 2 --offset 0
bun start history --limit 2 --offset 2
```

Verify JSON includes `"offset": 0` and `"offset": 2` respectively, and meals differ.

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --offset flag to history command"
```

---

## Task 3: Add `getTrendData()` to `db.ts`

**Files:**
- Modify: `src/db.ts` (add new exported function)
- Test: append to `scripts/test-agent-features.ts`

**Step 1: Write the failing test**

Append to `scripts/test-agent-features.ts`:

```typescript
import { getTrendData } from "../src/db";

// ---- Trends test ----
// We already have 5 meals logged from the offset tests above (all on today's date)

const trends = getTrendData(7);

// Should have the period
console.assert(trends.days === 7, `Expected days=7, got ${trends.days}`);
console.assert(typeof trends.period.from === "string", "period.from should be a string");
console.assert(typeof trends.period.to === "string", "period.to should be a string");

// Averages should be computed
console.assert(typeof trends.averages.calories === "number", "averages.calories should be a number");

// Daily array should have entries for days with data
console.assert(Array.isArray(trends.daily), "daily should be an array");
console.assert(trends.daily.length >= 1, "Should have at least 1 day with data");

// Each daily entry should have the right shape
const day = trends.daily[0]!;
console.assert(typeof day.date === "string", "daily[].date should be a string");
console.assert(typeof day.calories === "number", "daily[].calories should be a number");
console.assert(typeof day.protein === "number", "daily[].protein should be a number");
console.assert(typeof day.mealCount === "number", "daily[].mealCount should be a number");

console.log("✅ Trends data tests passed");
```

**Step 2: Run test to verify it fails**

```bash
bun run scripts/test-agent-features.ts
```
Expected: FAIL — `getTrendData` is not exported from `../src/db`

**Step 3: Implement getTrendData**

Add to `src/db.ts`:

```typescript
export interface TrendData {
  days: number;
  period: { from: string; to: string };
  averages: { calories: number; protein: number; carbs: number; fat: number };
  daily: Array<{
    date: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    mealCount: number;
  }>;
}

export function getTrendData(days: number): TrendData {
  const db = getDb();
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days + 1);

  const toStr = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, "0")}-${String(to.getDate()).padStart(2, "0")}`;
  const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;

  const rows = db.query(`
    SELECT
      date(logged_at) as date,
      COALESCE(SUM(calories), 0) as calories,
      COALESCE(SUM(protein), 0) as protein,
      COALESCE(SUM(carbs), 0) as carbs,
      COALESCE(SUM(fat), 0) as fat,
      COUNT(*) as meal_count
    FROM meals
    WHERE date(logged_at) >= date(?) AND date(logged_at) <= date(?)
    GROUP BY date(logged_at)
    ORDER BY date ASC
  `).all(fromStr, toStr) as Array<{
    date: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_count: number;
  }>;

  const daily = rows.map(r => ({
    date: r.date,
    calories: Math.round(r.calories * 10) / 10,
    protein: Math.round(r.protein * 10) / 10,
    carbs: Math.round(r.carbs * 10) / 10,
    fat: Math.round(r.fat * 10) / 10,
    mealCount: r.meal_count,
  }));

  const daysWithData = daily.length;
  const averages = daysWithData > 0
    ? {
        calories: Math.round(daily.reduce((s, d) => s + d.calories, 0) / daysWithData * 10) / 10,
        protein: Math.round(daily.reduce((s, d) => s + d.protein, 0) / daysWithData * 10) / 10,
        carbs: Math.round(daily.reduce((s, d) => s + d.carbs, 0) / daysWithData * 10) / 10,
        fat: Math.round(daily.reduce((s, d) => s + d.fat, 0) / daysWithData * 10) / 10,
      }
    : { calories: 0, protein: 0, carbs: 0, fat: 0 };

  return { days, period: { from: fromStr, to: toStr }, averages, daily };
}
```

**Step 4: Run test to verify it passes**

```bash
bun run scripts/test-agent-features.ts
```
Expected: PASS — "✅ Trends data tests passed"

**Step 5: Commit**

```bash
git add src/db.ts scripts/test-agent-features.ts
git commit -m "feat: add getTrendData for time-series nutrition data"
```

---

## Task 4: Add `trends` CLI command

**Files:**
- Modify: `src/cli.ts` (add `case "trends"` before `default:`, update `showHelp()`)
- Modify: `src/db.ts` imports at top of cli.ts

**Step 1: Add trends case to CLI switch**

In `src/cli.ts`, add before `case "mcp":`:

```typescript
case "trends": {
  const days = parsePositiveInt(flags.days, 7, 90);
  const data = getTrendData(days);

  const humanLines = [
    `Nutrition Trends (${data.period.from} to ${data.period.to})\n`,
    `Averages (${data.daily.length} days with data):`,
    `  Calories: ${data.averages.calories}`,
    `  Protein:  ${data.averages.protein}g`,
    `  Carbs:    ${data.averages.carbs}g`,
    `  Fat:      ${data.averages.fat}g`,
    `\nDaily Breakdown:`,
    ...data.daily.map(
      d => `  ${d.date}: ${d.calories} cal | ${d.protein}p ${d.carbs}c ${d.fat}f (${d.mealCount} meals)`
    ),
  ];

  printResult(data, humanLines.join("\n"));
  break;
}
```

**Step 2: Add `getTrendData` import**

At top of `src/cli.ts`, add `getTrendData` to the import from `"./db"`.

**Step 3: Update help text**

In `showHelp()`, add after the history section:

```
  trends [options]            Show nutrition trends over time
    --days <n>                Number of days to analyze (default: 7, max: 90)
```

**Step 4: Manual test**

```bash
bun start trends --days 7
bun start trends --days 7 --human
```

Verify JSON output has `days`, `period`, `averages`, `daily` fields.

**Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add trends CLI command for time-series nutrition data"
```

---

## Task 5: Add unified goals to `today` output

**Files:**
- Modify: `src/cli.ts:622-643` (`case "today"` block)

**Step 1: Update the today handler**

In `src/cli.ts`, replace the `case "today"` block to include goals/remaining:

```typescript
case "today": {
  const offsetDays = parseInt(flags.date ?? "0", 10);
  const today = computeDateStr(isNaN(offsetDays) ? 0 : offsetDays);
  const meals = getMealsByDate(today);
  const totals = getDailyTotals(today);

  // Try to get goals from the goals system
  const goals = getGoals();
  let goalsObj: Record<string, number> | null = null;
  let remainingObj: Record<string, number> | null = null;

  if (goals.length > 0) {
    goalsObj = {};
    remainingObj = {};
    for (const g of goals) {
      goalsObj[g.key] = g.target;
      const actual = totals[g.key as keyof typeof totals] as number;
      remainingObj[g.key] = Math.max(0, Math.round((g.target - actual) * 10) / 10);
    }
  }

  const result: Record<string, unknown> = {
    date: today,
    totals,
    meals: meals.map(formatMeal),
  };
  if (goalsObj) result.goals = goalsObj;
  if (remainingObj) result.remaining = remainingObj;

  printResult(
    result,
    `Today's Summary (${today})\n` +
      `${totals.mealCount} meals | ${totals.calories} cal | ${totals.protein}p ${totals.carbs}c ${totals.fat}f\n` +
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
                  `  ${m.calories ?? "?"} cal | ${m.protein ?? "?"}p ${m.carbs ?? "?"}c ${m.fat ?? "?"}f${m.notes ? ` | ${m.notes}` : ""} | ${m.loggedAt}`
            )
            .join("\n"))
  );
  break;
}
```

**Step 2: Manual test**

```bash
# Set some goals first
bun start goals --calories 2000 --protein 150
# Log a meal
bun start log "Chicken" --calories 500 --protein 40
# Check today
bun start today
```

Verify JSON includes `"goals": {"calories": 2000, "protein": 150}` and `"remaining": {"calories": 1500, "protein": 110}`.

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add goals and remaining to today output"
```

---

## Task 6: Update README and run full verification

**Files:**
- Modify: `README.md`

**Step 1: Add trends and offset docs to README**

Add after the `history` section:

```markdown
### trends [options]

Show nutrition trends over time, pre-computed for AI agents.

Options:
- `--days <n>` - Number of days to analyze (default: 7, max: 90)

```bash
bun start trends --days 7
```

Returns:
```json
{
  "days": 7,
  "period": { "from": "2026-02-16", "to": "2026-02-22" },
  "averages": { "calories": 2100, "protein": 145, "carbs": 190, "fat": 55 },
  "daily": [
    { "date": "2026-02-16", "calories": 1900, "protein": 130, "carbs": 180, "fat": 50, "mealCount": 3 }
  ]
}
```
```

Update the `history` options to include `--offset`:

```markdown
Options:
- `--limit <n>` - Max results (default: 20, max: 500)
- `--offset <n>` - Skip first N results for pagination (default: 0)
```

**Step 2: Run full test suite**

```bash
bun test
bun run scripts/test-agent-features.ts
```

**Step 3: Manual end-to-end**

```bash
bun start trends --days 7
bun start history --limit 2 --offset 0
bun start history --limit 2 --offset 2
bun start today
```

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add trends command and --offset to README"
```
