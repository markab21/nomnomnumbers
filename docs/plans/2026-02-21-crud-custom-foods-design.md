# Design: Delete/Edit Meals + Custom Foods

Date: 2026-02-21

## Overview

Three related features to improve meal management and food tracking:

1. **Delete meal** — remove logged meals by ID
2. **Edit meal** — modify existing meal entries
3. **Custom foods** — user-defined foods that integrate with USDA search

## 1. Delete Meal

**Command:** `nomnom delete <id>`

**Behavior:**
- Fetch meal by UUID to confirm it exists and get food name
- Delete the row
- Error if ID not found

**Output:**
```json
{ "success": true, "id": "uuid", "foodName": "Eggs" }
```

**Error:**
```json
{ "error": "Meal not found: <id>" }
```

## 2. Edit Meal

**Command:** `nomnom edit <id> [--food <name>] [--qty <n>] [--unit <u>] [--type <t>] [--calories <n>] [--protein <n>] [--carbs <n>] [--fat <n>] [--notes <text>]`

**Behavior:**
1. Fetch existing meal row by UUID (error if not found)
2. Merge provided flags on top of existing values (omitted fields unchanged)
3. Validate the merged result using same rules as `log` (valid meal type, etc.)
4. Replace the row wholesale (UPDATE with all fields)
5. Return success with list of changed fields

**Output:**
```json
{ "success": true, "id": "uuid", "foodName": "Eggs", "updated": ["calories", "protein"] }
```

**Design rationale:** Read-merge-validate-write ensures `edit` and `log` share the same validation path. No dynamic SQL — always a full row replacement.

## 3. Custom Foods

### Commands

- `nomnom foods add <name> [--calories <n>] [--protein <n>] [--carbs <n>] [--fat <n>] [--fiber <n>] [--sugar <n>] [--sodium <n>] [--serving <text>] [--brand <text>] [--barcode <text>]`
- `nomnom foods list`
- `nomnom foods delete <id>`

### Database

New `custom_foods` table in the **meal DB** (not the USDA DB — keeps USDA read-only):

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

CREATE VIRTUAL TABLE IF NOT EXISTS custom_foods_fts USING fts5(
  id UNINDEXED,
  description,
  brand
);
```

FTS index is kept in sync via triggers or manual insert/delete alongside the main table.

### Search Integration

The main `nomnom search <query>` returns results from **both** custom foods and USDA:

- Custom foods first, USDA foods after
- Each result includes `"source": "custom"` or `"source": "usda"`
- `--limit` applies per source: `--limit 5` returns up to 5 custom + 5 USDA (up to 10 total)
- The consuming AI agent sees both sets and decides which to use

**Updated search output:**
```json
{
  "query": "huel",
  "count": 6,
  "results": [
    {
      "id": "uuid",
      "description": "Huel Black Strawberry Banana",
      "brand": "Huel",
      "barcode": null,
      "servingSize": "1 bottle",
      "calories": 400,
      "protein": 40,
      "carbs": 37,
      "fat": 13,
      "fiber": null,
      "sugar": null,
      "sodium": null,
      "source": "custom"
    },
    {
      "fdcId": 123456,
      "description": "Meal Replacement Shake...",
      "source": "usda"
    }
  ]
}
```

Custom food results use `"id"` (UUID). USDA results use `"fdcId"` (integer). Both have `"source"`.

### Barcode Lookup Integration

`nomnom lookup <barcode>` checks custom foods first, then USDA. Response includes `"source"` field.

### Output Contracts

**foods add:**
```json
{ "success": true, "id": "uuid", "name": "Huel Black Strawberry Banana" }
```

**foods list:**
```json
{
  "count": 2,
  "foods": [
    {
      "id": "uuid",
      "name": "Huel Black Strawberry Banana",
      "brand": "Huel",
      "barcode": null,
      "servingSize": "1 bottle",
      "calories": 400,
      "protein": 40,
      "carbs": 37,
      "fat": 13,
      "fiber": null,
      "sugar": null,
      "sodium": null,
      "createdAt": "2026-02-21 12:00:00"
    }
  ]
}
```

**foods delete:**
```json
{ "success": true, "id": "uuid", "name": "Huel Black Strawberry Banana" }
```

**Error (not found):**
```json
{ "error": "Custom food not found: <id>" }
```

## Design Principles

- **CLI is data layer, AI is interpretation layer** — no opinions, just raw data
- **Log stays simple** — agent searches, reads macros, passes them to `log` manually
- **USDA DB stays read-only** — custom foods live in the meal DB
- **Validation shared** — edit uses same validation path as log
