# Meal Logging Scenario Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Validate the `log`, `today`, and `history` commands across realistic and edge-case meal logging scenarios using subagents that log meals and a separate interpreter agent that verifies the output looks correct.

**Architecture:** Each scenario is self-contained: a "logger" subagent runs a sequence of CLI commands to log meals, then an "interpreter" subagent reads the output and verifies it makes sense. The meal DB is cleared between scenarios. Scenarios cover: basic logging, zeros, negatives, float quantities, all meal types, long notes, missing fields, flag=value syntax, and -- sentinel.

**Tech Stack:** Bun CLI (`bun start`), SQLite at `~/.local/share/nomnom/nomnom.db`

**DB Reset command:** `rm -f ~/.local/share/nomnom/nomnom.db`

---

## Scenario Matrix

| # | Name | What it tests |
|---|------|---------------|
| 1 | Happy path breakfast | Basic log with all macros, type=breakfast, today summary |
| 2 | Zero macros | --calories 0 --protein 0 stored as 0 not null |
| 3 | Negative calories (deficit log) | --calories -50 parses correctly |
| 4 | Float quantity | --qty 1.5 stored as 1.5 |
| 5 | All meal types | breakfast, lunch, dinner, snack each logged once |
| 6 | --flag=value syntax | --calories=200 --protein=30 using equals syntax |
| 7 | Long notes | --notes with spaces and special chars |
| 8 | Minimal log (no macros) | just food name, no flags |
| 9 | history limit | Log 3 meals, history --limit 2 returns 2 |
| 10 | -- sentinel | food name with -- separator, positional arg after -- |

---

## Task 1: Happy Path Breakfast

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Scrambled Eggs" --qty 3 --unit egg --type breakfast --calories 210 --protein 18 --carbs 3 --fat 15
bun start today
```

**Expected log output:**
```json
{ "success": true, "id": "<uuid>", "foodName": "Scrambled Eggs", "quantity": 3 }
```

**Expected today output:**
- `date` matches today's local date (YYYY-MM-DD)
- `totals.calories` = 210, `totals.protein` = 18, `totals.carbs` = 3, `totals.fat` = 15, `totals.mealCount` = 1
- `meals[0].mealType` = "breakfast"
- `meals[0].unit` = "egg"
- `meals[0].quantity` = 3

**Interpreter checks:**
- All fields present and correct
- `id` is a non-empty string (UUID)
- No null values for calories/protein/carbs/fat

---

## Task 2: Zero Macros

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Black Coffee" --calories 0 --protein 0 --carbs 0 --fat 0
bun start today
```

**Expected log output:**
```json
{ "success": true, "id": "<uuid>", "foodName": "Black Coffee", "quantity": 1 }
```

**Expected today output:**
- `totals.calories` = 0 (not null, not missing)
- `meals[0].calories` = 0
- `meals[0].protein` = 0
- `meals[0].carbs` = 0
- `meals[0].fat` = 0

**Interpreter checks:**
- All macro values are exactly `0`, NOT `null`
- This validates the `??` (nullish coalescing) fix

---

## Task 3: Negative Calories

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Calorie Offset" --calories -50 --protein 0
bun start today
```

**Expected log output:**
- `"foodName": "Calorie Offset"` (NOT "Calorie Offset -50")
- `"quantity": 1`

**Expected today output:**
- `meals[0].calories` = -50
- `meals[0].foodName` = "Calorie Offset"

**Interpreter checks:**
- `foodName` does NOT contain "-50"
- `calories` is -50 as a number

---

## Task 4: Float Quantity

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Olive Oil" --qty 1.5 --unit tbsp --calories 180 --fat 21
bun start today
```

**Expected today output:**
- `meals[0].quantity` = 1.5 (number, not string)
- `meals[0].unit` = "tbsp"

**Interpreter checks:**
- `quantity` is 1.5 as a number (not "1.5" string)
- `unit` is "tbsp"

---

## Task 5: All Meal Types

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Oatmeal" --type breakfast --calories 150
bun start log "Chicken Salad" --type lunch --calories 350
bun start log "Pasta" --type dinner --calories 600
bun start log "Apple" --type snack --calories 95
bun start today
```

**Expected today output:**
- `totals.mealCount` = 4
- `totals.calories` = 1195
- meals contain one each of: breakfast, lunch, dinner, snack

**Interpreter checks:**
- All 4 meal types present in `meals` array
- Totals add up correctly (150+350+600+95=1195)
- `mealType` field present on every meal

---

## Task 6: --flag=value Syntax

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Protein Bar" --calories=200 --protein=20 --carbs=25 --fat=8 --type=snack --qty=1
bun start today
```

**Expected today output:**
- `meals[0].calories` = 200
- `meals[0].protein` = 20
- `meals[0].mealType` = "snack"
- `meals[0].quantity` = 1

**Interpreter checks:**
- All values parsed correctly from `=` syntax
- No values treated as positional args

---

## Task 7: Long Notes with Spaces

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Homemade Soup" --calories 250 --notes "Made with chicken broth, vegetables, and herbs"
bun start today
```

**Expected today output:**
- `meals[0].notes` = "Made with chicken broth, vegetables, and herbs"
- notes are not truncated

**Interpreter checks:**
- `notes` field is the full string
- Spaces and commas preserved

---

## Task 8: Minimal Log (No Macros)

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Mystery Snack"
bun start today
```

**Expected log output:**
```json
{ "success": true, "id": "<uuid>", "foodName": "Mystery Snack", "quantity": 1 }
```

**Expected today output:**
- `meals[0].calories` = null
- `meals[0].protein` = null
- `meals[0].mealType` = "snack" (default)
- `meals[0].unit` = "serving" (default)
- `meals[0].quantity` = 1

**Interpreter checks:**
- Macro fields are `null` (not 0, not missing)
- Defaults applied: mealType=snack, unit=serving, qty=1

---

## Task 9: History Limit

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Meal A" --calories 100
bun start log "Meal B" --calories 200
bun start log "Meal C" --calories 300
bun start history --limit 2
bun start history --limit 1
bun start history
```

**Expected outputs:**
- `history --limit 2`: `count` = 2, 2 meals in array (most recent first)
- `history --limit 1`: `count` = 1, 1 meal
- `history` (default): `count` = 3, all 3 meals

**Interpreter checks:**
- Limit is respected
- Most recent meal appears first
- Count matches array length

---

## Task 10: -- Sentinel and Multi-Word Food

**DB reset before run.**

**Logger subagent steps:**
```bash
rm -f ~/.local/share/nomnom/nomnom.db
bun start log "Peanut Butter Toast" --calories 320 --protein 12
bun start history
```

**Expected today output:**
- `meals[0].foodName` = "Peanut Butter Toast" (multi-word name preserved)

**Interpreter checks:**
- Multi-word food names concatenated correctly from positional args
- No truncation of food name

---

## Execution Order

Run tasks sequentially. After each logger run:
1. Capture stdout JSON
2. Capture stderr (for unexpected errors)
3. Check exit code
4. Pass both to interpreter subagent
5. Interpreter returns: PASS or FAIL with explanation
6. Reset DB before next scenario

## Pass Criteria

All 10 scenarios must PASS for the test run to be considered successful.
