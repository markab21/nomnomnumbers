# CLI Bugfixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 21 bugs/issues discovered during smoke testing of NomNom Numbers CLI.

**Architecture:** Two source files (`src/cli.ts` ~406 lines, `src/db.ts` ~564 lines). Zero external dependencies, uses Bun's built-in SQLite. All fixes are in these two files. We'll fix issues in dependency order: flag parser first (enables testing everything else), then DB layer, then CLI handlers, then human output polish.

**Tech Stack:** TypeScript, Bun runtime, Bun's built-in SQLite, FTS5

---

## Phase 1: Flag Parser Fixes (Issues #3, #7)

These must be fixed first because all other CLI functionality depends on correct flag parsing.

### Task 1: Support `-h` single-dash flag and `--flag=value` syntax

**Files:**
- Modify: `src/cli.ts:28-49` (parseFlags function)

**Step 1: Fix parseFlags to handle single-dash flags and `--flag=value` syntax**

Replace the `parseFlags` function at `src/cli.ts:28-49` with:

```typescript
function parseFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      // Handle --flag=value syntax
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
        continue;
      }
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("-")) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (arg?.startsWith("-") && arg.length === 2) {
      // Handle single-letter flags like -h, -n
      const key = arg.slice(1);
      const value = args[i + 1];
      if (value && !value.startsWith("-")) {
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
```

Key changes:
- `--flag=value` splits on first `=` sign
- `-x` single-letter flags now parsed (maps to `flags["x"]`)
- Next-value check changed from `!value.startsWith("--")` to `!value.startsWith("-")` so that `-h` after another flag isn't consumed as a value

**Step 2: Verify the `-h` flag works in `printResult`**

The existing `printResult` at `src/cli.ts:84-91` already checks `flags.h`, so single-dash `-h` will now work since `parseFlags` maps it to `flags["h"]`.

No change needed to `printResult`.

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "fix: support -h flag and --flag=value syntax in flag parser"
```

---

## Phase 2: DB Layer Fixes (Issues #1, #2, #10, #11)

### Task 2: Sanitize FTS5 query input

**Files:**
- Modify: `src/db.ts:323-348` (searchFoods function)

**Step 1: Add FTS5 query sanitization**

Replace lines 323-348 in `src/db.ts` with:

```typescript
export function searchFoods(query: string, limit: number = 10): FoodResult[] {
  const usda = getUSDAConnection();
  if (!usda) return [];

  // Sanitize for FTS5: strip special chars, quote each word as a literal term
  const words = query.trim()
    .replace(/[^\w\s]/g, " ")  // Remove all non-word, non-space chars
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w}"`);       // Quote each word to prevent FTS5 operator injection

  if (words.length === 0) return [];

  const ftsQuery = words.join(" ");

  const rows = usda.query(`
    SELECT f.fdc_id, f.description, f.brand, f.barcode, f.data
    FROM food_fts
    JOIN food f ON food_fts.fdc_id = f.fdc_id
    WHERE food_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit) as Array<{
    fdc_id: number;
    description: string;
    brand: string | null;
    barcode: string | null;
    data: string;
  }>;

  return rows.map(rowToFoodResult);
}
```

Key changes:
- Strip all non-alphanumeric/non-space characters (prevents `&`, `'`, `%` crashes)
- Quote each word with double quotes (prevents `OR`, `NOT`, `*` from being FTS5 operators)

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "fix: sanitize FTS5 search input to prevent injection and crashes"
```

### Task 3: Fix `0 || null` data loss in logMeal

**Files:**
- Modify: `src/db.ts:422-438` (logMeal stmt.run call)

**Step 1: Replace `||` with `??` for nullable numeric/string fields**

Replace lines 423-438 in `src/db.ts` with:

```typescript
  stmt.run(
    id,
    input.foodName,
    input.foodId ?? null,
    input.barcode ?? null,
    input.quantity,
    input.unit ?? "serving",
    input.mealType ?? "snack",
    input.notes ?? null,
    input.calories ?? null,
    input.protein ?? null,
    input.carbs ?? null,
    input.fat ?? null,
    input.fiber ?? null,
    input.sugar ?? null,
    input.sodium ?? null
  );
```

Key change: `||` -> `??` so that `0` is preserved as `0` instead of becoming `null`.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "fix: use nullish coalescing to preserve zero values in meal logging"
```

### Task 4: Fix `setDataDir` to also update `usdaDbPath`

**Files:**
- Modify: `src/db.ts:101-108` (setDataDir function)

**Step 1: Update setDataDir to also set usdaDbPath**

Replace lines 101-108 in `src/db.ts` with:

```typescript
export function setDataDir(path: string): void {
  const cfg = getConfig();
  cfg.dataDir = path;
  cfg.mealDbPath = join(path, "nomnom.db");
  cfg.usdaDbPath = join(path, "usda", "usda_fdc.sqlite");
  saveConfig(cfg);
  config = cfg;
  db = null;
  usdaDb = null;
}
```

Key changes:
- Set `usdaDbPath` relative to new data dir
- Reset `usdaDb` connection so it reconnects at new path

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "fix: setDataDir also updates usdaDbPath and resets USDA connection"
```

### Task 5: Fix config fallback paths to use config's dataDir

**Files:**
- Modify: `src/db.ts:47-69` (loadConfig function)

**Step 1: Use parsed dataDir for fallback paths**

Replace lines 47-69 in `src/db.ts` with:

```typescript
export function loadConfig(): Config {
  ensureDir(CONFIG_DIR);
  ensureDir(DATA_DIR);

  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const dataDir = parsed.dataDir || DATA_DIR;
      return {
        dataDir,
        usdaDbPath: parsed.usdaDbPath || join(dataDir, "usda", "usda_fdc.sqlite"),
        mealDbPath: parsed.mealDbPath || join(dataDir, "nomnom.db"),
      };
    } catch {
      // Invalid config, use defaults
    }
  }

  return {
    dataDir: DATA_DIR,
    usdaDbPath: join(DATA_DIR, "usda", "usda_fdc.sqlite"),
    mealDbPath: join(DATA_DIR, "nomnom.db"),
  };
}
```

Key change: When config has `dataDir` but not `usdaDbPath`/`mealDbPath`, fall back to paths relative to the config's `dataDir` (not the constant `DATA_DIR`).

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "fix: config fallback paths use configured dataDir, not default"
```

---

## Phase 3: CLI Input Validation (Issues #4, #5, #6, #9, #12, #13)

### Task 6: Validate `--limit` flag (Issues #4, #5)

**Files:**
- Modify: `src/cli.ts` (search and history command handlers)

**Step 1: Add a `parsePositiveInt` helper and use it**

Add this helper function after `parseFlags` (around line 49):

```typescript
function parsePositiveInt(value: string | undefined, defaultValue: number, max: number = 100): number {
  if (value === undefined) return defaultValue;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) return defaultValue;
  return Math.min(n, max);
}
```

Then in the `search` handler (around line 299), replace:
```typescript
const limit = parseInt(flags.limit || "10", 10);
```
with:
```typescript
const limit = parsePositiveInt(flags.limit, 10, 100);
```

And in the `history` handler (around line 382), replace:
```typescript
const limit = parseInt(flags.limit || "20", 10);
```
with:
```typescript
const limit = parsePositiveInt(flags.limit, 20, 500);
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "fix: validate --limit flag to prevent DoS and NaN errors"
```

### Task 7: Validate args before USDA download (Issue #6)

**Files:**
- Modify: `src/cli.ts` (search and lookup handlers)

**Step 1: Move arg validation before ensureUSDA**

In the `search` handler, move the query check before the USDA download. Replace the search case (around lines 292-313) with:

```typescript
    case "search": {
      const query = positional.join(" ");
      if (!query) printError("Usage: nomnom search <query>");
      const limit = parsePositiveInt(flags.limit, 10, 100);
      const usda = await ensureUSDA();
      if (!usda.ready) {
        printError(usda.error || "USDA database not available");
      }
      const results = searchFoods(query, limit);
      printResult(
        { query, count: results.length, results: results.map(formatFood) },
        results.length === 0
          ? `No results for "${query}"`
          : results
              .map(
                (f, i) =>
                  `${i + 1}. ${f.description}${f.brand ? ` (${f.brand})` : ""}\n` +
                  `   ${f.calories ?? "?"} cal | ${f.protein ?? "?"}p ${f.carbs ?? "?"}c ${f.fat ?? "?"}f`
              )
              .join("\n\n")
      );
      break;
    }
```

In the `lookup` handler, move the barcode check before USDA download. Replace the lookup case (around lines 316-333) with:

```typescript
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
```

Note: This step also fixes Issue #8 for search/lookup by changing `||` to `??` in human output.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "fix: validate required args before downloading USDA database"
```

### Task 8: Fix quantity type inconsistency and validate numeric flags (Issues #9, #12, #13)

**Files:**
- Modify: `src/cli.ts` (log command handler, around lines 336-356)

**Step 1: Add parseOptionalFloat helper and meal type validation**

Add this helper after `parsePositiveInt`:

```typescript
function parseOptionalFloat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);
```

**Step 2: Fix the log command handler**

Replace the log case (around lines 336-356) with:

```typescript
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
```

Key changes:
- `quantity` is always a number (fixes Issue #9 type inconsistency)
- `parseOptionalFloat` returns `undefined` for NaN (fixes Issue #12 `--calories` with no value)
- Meal type validated against allowed set (fixes Issue #13)

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "fix: validate quantity, numeric flags, and meal type in log command"
```

---

## Phase 4: Human Output Fixes (Issues #8, #17, #21)

### Task 9: Fix `0` displayed as `?` in human output (Issue #8)

**Files:**
- Modify: `src/cli.ts` (today and history handlers)

**Step 1: Replace `||` with `??` in all human output formatting**

In the `today` handler (around lines 371-374), replace:
```typescript
                    `- ${m.foodName} (${m.quantity} ${m.unit})\n` +
                      `  ${m.calories || "?"} cal | ${m.protein || "?"}p | ${m.loggedAt}`
```
with:
```typescript
                    `- ${m.foodName} (${m.quantity} ${m.unit}) [${m.mealType}]\n` +
                      `  ${m.calories ?? "?"} cal | ${m.protein ?? "?"}p ${m.carbs ?? "?"}c ${m.fat ?? "?"}f${m.notes ? ` | ${m.notes}` : ""} | ${m.loggedAt}`
```

This also fixes Issue #21 (today human output missing carbs, fat, notes, mealType per meal).

In the `history` handler (around lines 391-392), replace:
```typescript
                    `  ${m.calories || "?"} cal | ${m.protein || "?"}p ${m.carbs || "?"}c ${m.fat || "?"}f`
```
with:
```typescript
                    `  ${m.calories ?? "?"} cal | ${m.protein ?? "?"}p ${m.carbs ?? "?"}c ${m.fat ?? "?"}f`
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "fix: use ?? for human output so zero values display correctly"
```

### Task 10: Round floating-point totals (Issue #17)

**Files:**
- Modify: `src/db.ts:548-555` (getDailyTotals return)

**Step 1: Round totals to 1 decimal place**

Replace lines 548-555 in `src/db.ts` with:

```typescript
  return {
    calories: Math.round(row.calories * 10) / 10,
    protein: Math.round(row.protein * 10) / 10,
    carbs: Math.round(row.carbs * 10) / 10,
    fat: Math.round(row.fat * 10) / 10,
    mealCount: row.meal_count,
  };
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "fix: round daily totals to 1 decimal to avoid floating-point artifacts"
```

---

## Phase 5: Minor Cleanup (Issues #14, #18, #19)

### Task 11: Fix printResult re-parsing argv and add return after printError (Issues #18, #19)

**Files:**
- Modify: `src/cli.ts`

**Step 1: Pass human flag through instead of re-parsing**

Replace `printResult` at `src/cli.ts:84-91` with:

```typescript
let humanMode = false;

function printResult(data: unknown, human?: string) {
  if (humanMode) {
    console.log(human || JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
```

Then in `main()`, after `parseFlags` is called (around line 190), add:

```typescript
  humanMode = flags.human === "true" || flags.h === "true";
```

**Step 2: Add `return` after all `printError` calls**

`printError` calls `process.exit(1)` so control flow technically never returns, but for type safety and clarity, add `return` after each `printError` call. In practice, TypeScript doesn't know `printError` never returns, so change its return type:

Replace `printError` at `src/cli.ts:93-96` with:

```typescript
function printError(message: string): never {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}
```

Adding `: never` return type tells TypeScript this function never returns, so the `return` after `printError` is no longer needed for control flow safety. TypeScript will now error if code after `printError` is unreachable.

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "fix: printResult uses flag instead of re-parsing, printError typed as never"
```

### Task 12: Add timezone note to UTC timestamps (Issue #14)

**Files:**
- Modify: `src/cli.ts` (today handler, around line 360)

**Step 1: Use local date for "today" command**

Replace line 360:
```typescript
      const today = new Date().toISOString().split("T")[0];
```
with:
```typescript
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
```

This uses local date instead of UTC, so "today" matches the user's timezone.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "fix: use local date for today command instead of UTC"
```

---

## Phase 6: Final Verification

### Task 13: Full typecheck and manual smoke test

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 2: Test basic commands**

```bash
# Test help
bun start help

# Test -h flag
bun start help

# Test log with zero calories
bun start log "Test Zero" --calories 0 --protein 0 --human

# Test today
bun start today --human

# Test log with invalid meal type
bun start log "Bad Type" --type brunch

# Test search without query
bun start search

# Test --limit validation
bun start history --limit -1 --human
bun start history --limit abc --human

# Test --flag=value syntax
bun start log "Equals Test" --calories=200 --human
bun start today --human
```

**Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup after bugfix pass"
```

---

## Deferred Issues (Design-level, not fixing now)

The following issues are acknowledged but deferred as they represent design enhancements rather than bugs:

- **Issue #15:** Quantity not multiplied by nutritional values (design choice - quantity is informational)
- **Issue #16:** No delete/edit commands (feature request, not a bug)
- **Issue #20:** No SQLite SQLITE_BUSY retry (edge case, WAL mode mitigates most contention)

---

## Summary

| Phase | Tasks | Issues Fixed |
|-------|-------|-------------|
| 1. Flag Parser | Task 1 | #3, #7 |
| 2. DB Layer | Tasks 2-5 | #1, #2, #10, #11 |
| 3. Input Validation | Tasks 6-8 | #4, #5, #6, #9, #12, #13 |
| 4. Human Output | Tasks 9-10 | #8, #17, #21 |
| 5. Minor Cleanup | Tasks 11-12 | #14, #18, #19 |
| 6. Verification | Task 13 | (all) |

**Total: 13 tasks fixing 18 of 21 issues (3 deferred as design enhancements)**
