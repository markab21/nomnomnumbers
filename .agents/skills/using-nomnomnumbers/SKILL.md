---
name: using-nomnomnumbers
description: Use when you need to track meals, search nutrition data, or analyze dietary trends using the nomnom CLI.
---

# Using NomNom Numbers

NomNom Numbers is a CLI tool for nutrition tracking and food database searches, explicitly designed to be consumed by AI agents like you. 

## Core Principles

1. **Consume JSON**: NomNom outputs clean JSON to `stdout` by default. Read this directly; it's much easier for you to parse than human text.
2. **Handle Errors gracefully**: Errors, warnings, and progress bars are printed to `stderr`. A non-zero exit code means an error occurred. The `stderr` output will contain a JSON object with an `{"error": "..."}` key.
3. **Pillars of NomNom**:
   - `search`/`lookup`: Finding food data (USDA database + custom foods).
   - `log`/`today`/`history`: Recording and viewing meals.
   - `goals`/`progress`/`trends`: Gamification, targets, and time-series analysis.

## Key Commands

Run these via `bun start <command>` (or `nomnom <command>` if globally installed) from the project root.

### 1. Finding Food
- **Search:** `bun start search "chicken breast" --limit 5` (Searches 2M+ USDA items + custom foods)
- **Lookup:** `bun start lookup <barcode>` (Look up by UPC)
- **Custom Foods:** `bun start foods list` (or `add`, `delete`)

### 2. Logging Meals
- **Log:** `bun start log "Eggs" --qty 2 --calories 140 --protein 12 --type breakfast`
  - *Tip: Macros are optional. Missing macros will be saved as `null`.*
- **Edit/Delete:** `bun start edit <uuid> --qty 3` or `bun start delete <uuid>`

### 3. Viewing Data
- **Today:** `bun start today` (Returns today's meals, block totals, and remaining goals)
- **History:** `bun start history --limit 50 --offset 0` (Paginated historical meals)

### 4. Goals & Trends (Agent Analysis)
- **Trends:** `bun start trends --days 7`
  - *Extremely useful.* Returns pre-computed daily averages and breakdowns so you don't have to fetch `history` and do the math yourself.
- **Goals:** `bun start goals --calories 2000 --protein 150` (Sets daily targets)
- **Progress:** `bun start progress` (Shows gamified streak data, weekly rolling averages, and how close the user is to their goals today)

## Example Agent Workflow

If the user says: *"I ate a chicken breast for lunch, how am I doing today?"*

1. **Search for macros:** `bun start search "chicken breast" --limit 1`
2. **Log it:** `bun start log "Chicken Breast" --qty 1 --type lunch --calories 165 ...`
3. **Check status:** `bun start today`
4. **Respond:** Read the `remaining` block from step 3 and tell the user what they have left to eat. You can also run `bun start progress` to tell them about their current streaks!
