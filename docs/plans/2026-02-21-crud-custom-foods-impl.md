# Delete/Edit Meals + Custom Foods Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add delete meal, edit meal, and custom foods commands to the nomnom CLI, with custom foods integrated into the existing search and barcode lookup.

**Architecture:** Three new CLI commands (`delete`, `edit`, `foods`) backed by new DB functions in `src/db.ts`. Custom foods get their own table + FTS5 index in the meal DB. Search and lookup are extended to query both custom foods and USDA, returning results tagged with `"source"`.

**Tech Stack:** Bun, SQLite (via bun:sqlite), FTS5

---

### Task 1: Delete Meal — DB Layer

**Files:**
- Modify: `src/db.ts:422-466` (near `logMeal`)

**Step 1: Add `getMealById` function**

After the `logMeal` function (after line 466), add:

```typescript
export function getMealById(id: string): MealResult | null {
  const db = getDb();
  const row = db.query(`
    SELECT id, food_name, quantity, unit, meal_type, logged_at, notes,
           calories, protein, carbs, fat
    FROM meals WHERE id = ?
  `).get(id) as {
    id: string;
    food_name: string;
    quantity: number;
    unit: string;
    meal_type: string;
    logged_at: string;
    notes: string | null;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    foodName: row.food_name,
    quantity: row.quantity,
    unit: row.unit,
    mealType: row.meal_type,
    loggedAt: row.logged_at,
    notes: row.notes,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
  };
}
```

**Step 2: Add `deleteMeal` function**

After `getMealById`, add:

```typescript
export function deleteMeal(id: string): boolean {
  const db = getDb();
  const result = db.run("DELETE FROM meals WHERE id = ?", id);
  return result.changes > 0;
}
```

**Step 3: Verify with typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/db.ts
git commit -m "feat: add getMealById and deleteMeal to DB layer"
```

---

### Task 2: Delete Meal — CLI Command

**Files:**
- Modify: `src/cli.ts:152-207` (help text)
- Modify: `src/cli.ts:442` (add case before `log`)

**Step 1: Add `delete` case to the switch**

Add before the `log` case (before line 442). Import `getMealById` and `deleteMeal` from db.ts (update the existing import at top of file).

```typescript
      case "delete": {
        const id = positional[0];
        if (!id) printError("Usage: nomnom delete <id>");

        const meal = getMealById(id!);
        if (!meal) printError(`Meal not found: ${id}`);

        deleteMeal(id!);

        printResult(
          { success: true, id, foodName: meal!.foodName },
          `Deleted: ${meal!.foodName}`
        );
        break;
      }
```

**Step 2: Update help text**

In the `showHelp` function (lines 152-207), add after the `log` section:

```
  delete <id>                 Delete a logged meal by ID
```

**Step 3: Update imports**

Update the import from `"./db"` at the top of `cli.ts` to include `getMealById` and `deleteMeal`.

**Step 4: Test manually**

```bash
# Log a meal, capture the ID, then delete it
bun start log "Test Delete" --calories 100
# Copy the id from output
bun start delete <id>
# Verify it's gone
bun start today
```

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli.ts src/db.ts
git commit -m "feat: add delete meal command"
```

---

### Task 3: Edit Meal — DB Layer

**Files:**
- Modify: `src/db.ts` (after `deleteMeal`)

**Step 1: Add `updateMeal` function**

```typescript
export function updateMeal(id: string, input: {
  foodName: string;
  quantity: number;
  unit: string;
  mealType: string;
  notes: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}): boolean {
  const db = getDb();
  const result = db.run(`
    UPDATE meals SET
      food_name = ?, quantity = ?, unit = ?, meal_type = ?, notes = ?,
      calories = ?, protein = ?, carbs = ?, fat = ?
    WHERE id = ?
  `,
    input.foodName,
    input.quantity,
    input.unit,
    input.mealType,
    input.notes,
    input.calories,
    input.protein,
    input.carbs,
    input.fat,
    id
  );
  return result.changes > 0;
}
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat: add updateMeal to DB layer"
```

---

### Task 4: Edit Meal — CLI Command

**Files:**
- Modify: `src/cli.ts` (help text + new case)

**Step 1: Add `edit` case to the switch**

Add after the `delete` case. Import `updateMeal` from db.ts.

```typescript
      case "edit": {
        const id = positional[0];
        if (!id) printError("Usage: nomnom edit <id> [--food <name>] [--qty <n>] [--calories <n>] ...");

        const existing = getMealById(id!);
        if (!existing) printError(`Meal not found: ${id}`);

        // Merge flags on top of existing values
        const merged = {
          foodName: flags.food || existing!.foodName,
          quantity: parseOptionalFloat(flags.qty) ?? existing!.quantity,
          unit: flags.unit || existing!.unit,
          mealType: flags.type || existing!.mealType,
          notes: flags.notes !== undefined ? flags.notes : existing!.notes,
          calories: flags.calories !== undefined ? parseOptionalFloat(flags.calories) ?? null : existing!.calories,
          protein: flags.protein !== undefined ? parseOptionalFloat(flags.protein) ?? null : existing!.protein,
          carbs: flags.carbs !== undefined ? parseOptionalFloat(flags.carbs) ?? null : existing!.carbs,
          fat: flags.fat !== undefined ? parseOptionalFloat(flags.fat) ?? null : existing!.fat,
        };

        // Same validation as log
        if (!VALID_MEAL_TYPES.has(merged.mealType)) {
          printError(`Invalid meal type "${merged.mealType}". Must be one of: breakfast, lunch, dinner, snack`);
        }

        // Determine which fields changed
        const updated: string[] = [];
        if (merged.foodName !== existing!.foodName) updated.push("food");
        if (merged.quantity !== existing!.quantity) updated.push("quantity");
        if (merged.unit !== existing!.unit) updated.push("unit");
        if (merged.mealType !== existing!.mealType) updated.push("type");
        if (merged.notes !== existing!.notes) updated.push("notes");
        if (merged.calories !== existing!.calories) updated.push("calories");
        if (merged.protein !== existing!.protein) updated.push("protein");
        if (merged.carbs !== existing!.carbs) updated.push("carbs");
        if (merged.fat !== existing!.fat) updated.push("fat");

        if (updated.length === 0) {
          printResult(
            { success: true, id, foodName: merged.foodName, updated: [] },
            `No changes to ${merged.foodName}`
          );
          break;
        }

        updateMeal(id!, merged);

        printResult(
          { success: true, id, foodName: merged.foodName, updated },
          `Updated ${merged.foodName}: ${updated.join(", ")}`
        );
        break;
      }
```

**Step 2: Update help text**

Add after the `delete` line in `showHelp`:

```
  edit <id> [options]         Edit a logged meal
    --food <name>             Food name
    --qty <n>                 Quantity
    --unit <u>                Unit
    --type <t>                Meal type
    --calories <n>            Calories
    --protein <n>             Protein (g)
    --carbs <n>               Carbs (g)
    --fat <n>                 Fat (g)
    --notes <text>            Notes
```

**Step 3: Update imports**

Add `updateMeal` to the import from `"./db"`.

**Step 4: Test manually**

```bash
bun start log "Test Edit" --calories 100 --protein 10
# Copy the id
bun start edit <id> --calories 200 --fat 15
bun start today  # verify changes
```

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli.ts src/db.ts
git commit -m "feat: add edit meal command"
```

---

### Task 5: Custom Foods — DB Layer

**Files:**
- Modify: `src/db.ts:271-310` (`initTables`)
- Modify: `src/db.ts` (new functions after barcode lookup)

**Step 1: Add custom_foods table to initTables**

Inside the `initTables` function (line 271), add to the `db.exec` block, after the goals table:

```sql
    CREATE TABLE IF NOT EXISTS custom_foods (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      brand TEXT,
      barcode TEXT,
      serving_size TEXT,
      calories REAL,
      protein REAL,
      carbs REAL,
      fat REAL,
      fiber REAL,
      sugar REAL,
      sodium REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

**Step 2: Add FTS5 index creation**

After the `initTables` function, add a helper that ensures the custom foods FTS index exists (similar pattern to `ensureUSDAFTS` at line 249):

```typescript
function ensureCustomFoodsFTS(db: Database): void {
  const hasFTS = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_foods_fts'"
  ).get();

  if (!hasFTS) {
    db.exec(`
      CREATE VIRTUAL TABLE custom_foods_fts USING fts5(
        id UNINDEXED,
        description,
        brand
      )
    `);
    // Populate from existing data (migration path)
    db.exec(
      "INSERT INTO custom_foods_fts(id, description, brand) SELECT id, description, COALESCE(brand, '') FROM custom_foods"
    );
  }
}
```

Call `ensureCustomFoodsFTS(db)` at the end of `initTables`.

**Step 3: Add CustomFood interface**

Near the other type definitions (around line 312):

```typescript
export interface CustomFood {
  id: string;
  description: string;
  brand: string | null;
  barcode: string | null;
  servingSize: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
  createdAt: string;
}
```

**Step 4: Add `addCustomFood` function**

```typescript
export function addCustomFood(input: {
  description: string;
  brand?: string;
  barcode?: string;
  servingSize?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}): string {
  const db = getDb();
  const id = crypto.randomUUID();

  db.query(`
    INSERT INTO custom_foods (id, description, brand, barcode, serving_size,
                              calories, protein, carbs, fat, fiber, sugar, sodium)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.description,
    input.brand ?? null,
    input.barcode ?? null,
    input.servingSize ?? null,
    input.calories ?? null,
    input.protein ?? null,
    input.carbs ?? null,
    input.fat ?? null,
    input.fiber ?? null,
    input.sugar ?? null,
    input.sodium ?? null
  );

  // Keep FTS in sync
  db.query("INSERT INTO custom_foods_fts(id, description, brand) VALUES (?, ?, ?)").run(
    id, input.description, input.brand ?? ""
  );

  return id;
}
```

**Step 5: Add `listCustomFoods` function**

```typescript
export function listCustomFoods(): CustomFood[] {
  const db = getDb();
  const rows = db.query(`
    SELECT id, description, brand, barcode, serving_size, calories, protein,
           carbs, fat, fiber, sugar, sodium, created_at
    FROM custom_foods ORDER BY created_at DESC
  `).all() as Array<{
    id: string; description: string; brand: string | null; barcode: string | null;
    serving_size: string | null; calories: number | null; protein: number | null;
    carbs: number | null; fat: number | null; fiber: number | null;
    sugar: number | null; sodium: number | null; created_at: string;
  }>;

  return rows.map(r => ({
    id: r.id, description: r.description, brand: r.brand, barcode: r.barcode,
    servingSize: r.serving_size, calories: r.calories, protein: r.protein,
    carbs: r.carbs, fat: r.fat, fiber: r.fiber, sugar: r.sugar,
    sodium: r.sodium, createdAt: r.created_at,
  }));
}
```

**Step 6: Add `deleteCustomFood` function**

```typescript
export function deleteCustomFood(id: string): { deleted: boolean; description: string | null } {
  const db = getDb();
  const row = db.query("SELECT description FROM custom_foods WHERE id = ?").get(id) as { description: string } | null;
  if (!row) return { deleted: false, description: null };

  db.run("DELETE FROM custom_foods WHERE id = ?", id);
  db.run("DELETE FROM custom_foods_fts WHERE id = ?", id);

  return { deleted: true, description: row.description };
}
```

**Step 7: Add `searchCustomFoods` function**

```typescript
export function searchCustomFoods(query: string, limit: number = 10): CustomFood[] {
  const db = getDb();

  const words = query.trim()
    .replace(/["\*\+\^\(\)\{\}~|\\!:\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w}"`);

  if (words.length === 0) return [];

  const ftsQuery = words.join(" ");

  const rows = db.query(`
    SELECT cf.id, cf.description, cf.brand, cf.barcode, cf.serving_size,
           cf.calories, cf.protein, cf.carbs, cf.fat, cf.fiber, cf.sugar,
           cf.sodium, cf.created_at
    FROM custom_foods_fts
    JOIN custom_foods cf ON custom_foods_fts.id = cf.id
    WHERE custom_foods_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit) as Array<{
    id: string; description: string; brand: string | null; barcode: string | null;
    serving_size: string | null; calories: number | null; protein: number | null;
    carbs: number | null; fat: number | null; fiber: number | null;
    sugar: number | null; sodium: number | null; created_at: string;
  }>;

  return rows.map(r => ({
    id: r.id, description: r.description, brand: r.brand, barcode: r.barcode,
    servingSize: r.serving_size, calories: r.calories, protein: r.protein,
    carbs: r.carbs, fat: r.fat, fiber: r.fiber, sugar: r.sugar,
    sodium: r.sodium, createdAt: r.created_at,
  }));
}
```

**Step 8: Add `lookupCustomBarcode` function**

```typescript
export function lookupCustomBarcode(barcode: string): CustomFood | null {
  const db = getDb();
  const row = db.query(`
    SELECT id, description, brand, barcode, serving_size, calories, protein,
           carbs, fat, fiber, sugar, sodium, created_at
    FROM custom_foods WHERE barcode = ? LIMIT 1
  `).get(barcode) as {
    id: string; description: string; brand: string | null; barcode: string | null;
    serving_size: string | null; calories: number | null; protein: number | null;
    carbs: number | null; fat: number | null; fiber: number | null;
    sugar: number | null; sodium: number | null; created_at: string;
  } | null;

  if (!row) return null;

  return {
    id: row.id, description: row.description, brand: row.brand, barcode: row.barcode,
    servingSize: row.serving_size, calories: row.calories, protein: row.protein,
    carbs: row.carbs, fat: row.fat, fiber: row.fiber, sugar: row.sugar,
    sodium: row.sodium, createdAt: row.created_at,
  };
}
```

**Step 9: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 10: Commit**

```bash
git add src/db.ts
git commit -m "feat: add custom foods DB layer with FTS5 search"
```

---

### Task 6: Custom Foods — CLI Commands

**Files:**
- Modify: `src/cli.ts` (help text + new `foods` case)

**Step 1: Add `foods` case to the switch**

Import `addCustomFood`, `listCustomFoods`, `deleteCustomFood` from db.ts.

```typescript
      case "foods": {
        const subcommand = positional[0];

        if (!subcommand || subcommand === "list") {
          const foods = listCustomFoods();
          printResult(
            { count: foods.length, foods: foods.map(f => ({
              id: f.id, name: f.description, brand: f.brand, barcode: f.barcode,
              servingSize: f.servingSize, calories: f.calories, protein: f.protein,
              carbs: f.carbs, fat: f.fat, fiber: f.fiber, sugar: f.sugar,
              sodium: f.sodium, createdAt: f.createdAt,
            })) },
            foods.length === 0
              ? "No custom foods"
              : foods.map((f, i) =>
                  `${i + 1}. ${f.description}${f.brand ? ` (${f.brand})` : ""}` +
                  `\n   ${f.calories ?? "?"} cal | ${f.protein ?? "?"}p ${f.carbs ?? "?"}c ${f.fat ?? "?"}f`
                ).join("\n\n")
          );
          break;
        }

        if (subcommand === "add") {
          const name = positional.slice(1).join(" ");
          if (!name) printError("Usage: nomnom foods add <name> [--calories <n>] ...");

          const id = addCustomFood({
            description: name,
            brand: flags.brand,
            barcode: flags.barcode,
            servingSize: flags.serving,
            calories: parseOptionalFloat(flags.calories),
            protein: parseOptionalFloat(flags.protein),
            carbs: parseOptionalFloat(flags.carbs),
            fat: parseOptionalFloat(flags.fat),
            fiber: parseOptionalFloat(flags.fiber),
            sugar: parseOptionalFloat(flags.sugar),
            sodium: parseOptionalFloat(flags.sodium),
          });

          printResult(
            { success: true, id, name },
            `Added custom food: ${name}`
          );
          break;
        }

        if (subcommand === "delete") {
          const id = positional[1];
          if (!id) printError("Usage: nomnom foods delete <id>");

          const result = deleteCustomFood(id);
          if (!result.deleted) printError(`Custom food not found: ${id}`);

          printResult(
            { success: true, id, name: result.description },
            `Deleted custom food: ${result.description}`
          );
          break;
        }

        printError(`Unknown foods subcommand "${subcommand}". Use: add, list, delete`);
        break;
      }
```

**Step 2: Update help text**

Add to `showHelp` after the `edit` section:

```
  foods [subcommand]          Manage custom foods
    foods add <name>          Add a custom food
      --calories <n>          Calories
      --protein <n>           Protein (g)
      --carbs <n>             Carbs (g)
      --fat <n>               Fat (g)
      --fiber <n>             Fiber (g)
      --sugar <n>             Sugar (g)
      --sodium <n>            Sodium (mg)
      --serving <text>        Serving size description
      --brand <text>          Brand name
      --barcode <text>        Barcode
    foods list                List all custom foods
    foods delete <id>         Delete a custom food
```

**Step 3: Test manually**

```bash
bun start foods add "Huel Black Strawberry Banana" --brand "Huel" --calories 400 --protein 40 --carbs 37 --fat 13 --serving "1 bottle"
bun start foods list
bun start foods list --human
bun start foods delete <id>
```

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts src/db.ts
git commit -m "feat: add foods command for custom food management"
```

---

### Task 7: Integrate Custom Foods into Search

**Files:**
- Modify: `src/cli.ts` (search case, lines 398-420)
- Modify: `src/cli.ts` (formatFood helper or add formatCustomFood)

**Step 1: Add `formatCustomFood` helper**

Near the existing `formatFood` function (around line 103), add:

```typescript
function formatCustomFood(f: CustomFood): Record<string, unknown> {
  return {
    id: f.id,
    description: f.description,
    brand: f.brand,
    barcode: f.barcode,
    servingSize: f.servingSize,
    calories: f.calories,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat,
    fiber: f.fiber,
    sugar: f.sugar,
    sodium: f.sodium,
    source: "custom",
  };
}
```

**Step 2: Update `formatFood` to include source**

Update the existing `formatFood` function to add `source: "usda"` to its output.

**Step 3: Update the `search` case**

Replace the search case to query both custom foods and USDA, combining results:

```typescript
      case "search": {
        const query = positional.join(" ");
        if (!query) printError("Usage: nomnom search <query>");
        const limit = parsePositiveInt(flags.limit, 10, 100);

        // Search custom foods first (no USDA dependency)
        const customResults = searchCustomFoods(query, limit);

        // Search USDA
        const usda = await ensureUSDA();
        let usdaResults: FoodResult[] = [];
        if (usda.ready) {
          usdaResults = searchFoods(query, limit);
        }

        const allResults = [
          ...customResults.map(formatCustomFood),
          ...usdaResults.map(formatFood),
        ];

        printResult(
          { query, count: allResults.length, results: allResults },
          allResults.length === 0
            ? `No results for "${query}"`
            : allResults
                .map(
                  (f, i) =>
                    `${i + 1}. [${f.source}] ${f.description}${f.brand ? ` (${f.brand})` : ""}\n` +
                    `   ${f.calories ?? "?"} cal | ${f.protein ?? "?"}p ${f.carbs ?? "?"}c ${f.fat ?? "?"}f`
                )
                .join("\n\n")
        );
        break;
      }
```

Important: `searchCustomFoods` must be imported from db.ts.

Note: When USDA is not available, search still works for custom foods (no error). Only show the USDA download prompt if both custom and USDA return zero results and USDA is not ready.

**Step 4: Test manually**

```bash
bun start foods add "Huel Black Strawberry Banana" --brand "Huel" --calories 400 --protein 40
bun start search "huel" --human
# Should show custom result first, then any USDA matches
bun start search "chicken" --human
# Should show only USDA results (no custom match)
```

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli.ts src/db.ts
git commit -m "feat: integrate custom foods into search results"
```

---

### Task 8: Integrate Custom Foods into Barcode Lookup

**Files:**
- Modify: `src/cli.ts` (lookup case, lines 422-440)

**Step 1: Update the `lookup` case**

Check custom foods first, then USDA. Import `lookupCustomBarcode` from db.ts.

```typescript
      case "lookup": {
        const barcode = positional[0];
        if (!barcode) printError("Usage: nomnom lookup <barcode>");

        // Check custom foods first
        const customFood = lookupCustomBarcode(barcode!);
        if (customFood) {
          printResult(
            { found: true, ...formatCustomFood(customFood) },
            `[custom] ${customFood.description}${customFood.brand ? ` (${customFood.brand})` : ""}\n` +
              `${customFood.calories ?? "?"} cal | ${customFood.protein ?? "?"}p ${customFood.carbs ?? "?"}c ${customFood.fat ?? "?"}f`
          );
          break;
        }

        // Fall back to USDA
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

**Step 2: Test manually**

```bash
bun start foods add "Test Barcode Food" --barcode "1234567890" --calories 200
bun start lookup 1234567890
# Should return custom food with source: "custom"
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli.ts src/db.ts
git commit -m "feat: integrate custom foods into barcode lookup"
```

---

### Task 9: Update AGENTS.md Documentation

**Files:**
- Modify: `AGENTS.md`

**Step 1: Add documentation for new commands**

Add the `delete`, `edit`, and `foods` commands to the CLI Commands section. Add JSON output contracts. Document the `source` field in search/lookup results.

**Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add delete, edit, and foods commands to AGENTS.md"
```

---

### Task 10: Smoke Test

**Files:**
- Create: `scripts/smoke-test-crud.ts`

**Step 1: Write smoke test**

Create a smoke test that exercises all new functionality:

1. Clean DB
2. `foods add` — add 2 custom foods (one with barcode)
3. `foods list` — verify both appear
4. `search` for custom food name — verify it appears with `source: "custom"`
5. `lookup` custom barcode — verify it returns with `source: "custom"`
6. `foods delete` — delete one, verify `foods list` count drops
7. `log` a meal
8. `edit` the meal — change calories, verify updated field list
9. `edit` with no changes — verify `updated: []`
10. `delete` the meal — verify success
11. `delete` with bad ID — verify error
12. `today` — verify meal is gone

**Step 2: Add script to package.json**

Add `"smoke:crud": "bun scripts/smoke-test-crud.ts"` to scripts.

**Step 3: Run the smoke test**

Run: `bun run smoke:crud`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add scripts/smoke-test-crud.ts package.json
git commit -m "test: add smoke test for delete, edit, and custom foods"
```

---

### Task 11: Version Bump

**Step 1: Bump version in package.json**

Update version from `2.1.0` to `2.2.0`.

**Step 2: Commit and push**

```bash
git add package.json
git commit -m "chore: bump version to 2.2.0"
git push
```

The CI workflow will auto-publish to npm and tag `v2.2.0`.
