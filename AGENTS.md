# AGENTS.md - Coding Agent Guidelines

## Project Overview

NomNom Numbers is a CLI-based nutrition tracking tool for AI agents. It provides food search via USDA SQLite with FTS5, barcode lookup, custom food management, and meal logging - all outputting JSON for easy parsing by AI tools.

## CLI Commands

```bash
nomnom help                    # Show all commands
nomnom init                    # Initialize database (auto-runs on first use)
nomnom search "chicken breast" # Search foods (JSON output)
nomnom lookup 00000000924665   # Lookup by barcode
nomnom log "eggs" --calories 150 --protein 12  # Log a meal
nomnom delete <id>                             # Delete a logged meal
nomnom edit <id> --calories 200                 # Edit a logged meal
nomnom today                   # Today's summary
nomnom history --limit 10      # Meal history
nomnom config                  # View configuration
nomnom goals --calories 2000 --protein 120  # Set daily goals
nomnom progress                              # Progress vs goals
nomnom foods add "My Shake" --calories 400      # Add custom food
nomnom foods list                               # List custom foods
nomnom foods delete <id>                        # Delete custom food
```

All commands output JSON to **stdout** by default. Add `--human` or `-h` after a command for readable format.

> **Note:** `nomnom -h` shows help and exits. Use `-h` after a command, e.g. `nomnom today -h`.

## MCP Server

NomNom Numbers includes an MCP (Model Context Protocol) server for AI agent integration.

### Starting the MCP server

```bash
nomnom mcp                    # After global install
bunx nomnomnumbers mcp        # Remote execution
nomnom-mcp                    # Direct binary
```

### MCP Configuration

For Claude Desktop or similar tools:

```json
{
  "mcpServers": {
    "nomnom": {
      "command": "bunx",
      "args": ["nomnomnumbers", "mcp"]
    }
  }
}
```

### Tool: nomnom

Single tool that accepts any CLI command string and returns JSON.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| command | string | yes | CLI command to run, e.g. "search chicken breast --limit 5" |

The tool returns the same JSON the CLI outputs. Run with command "help" for full usage.

### Output Contract (important for programmatic use)

| Stream | Content |
|--------|---------|
| **stdout** | Clean JSON result (or human-readable with `--human`) |
| **stderr** | Errors (JSON), download progress, init messages |

- **Exit code 0** — success; stdout is valid JSON
- **Exit code 1** — error; stderr contains `{ "error": "message" }`

Flags support both `--flag value` and `--flag=value` syntax. Negative numeric values are accepted (e.g. `--calories -50`).

**Validation behavior:**
- Invalid `--limit` values (NaN, < 1) silently use the default; values above max are capped
- Invalid `--calories`, `--protein`, etc. (NaN) are silently ignored (treated as not provided)
- Invalid `--type` values produce a JSON error on stderr and exit 1
- Missing required arguments (no query for search, no barcode for lookup, no food for log, no ID for delete/edit, no name for `foods add`, no ID for `foods delete`) produce a JSON error and exit 1

**Stderr messages during normal operation:**
- First run: `Initialized database at <path>`
- USDA auto-download: progress percentage lines
- First search after USDA download: `Building search index (one-time operation)...`

These go to stderr so they never corrupt the JSON on stdout.

### Command Details

**init**
- `--download-usda` - Download USDA food database
- Auto-runs on first use if database doesn't exist

Without `--download-usda`:
```json
{ "initialized": true, "dataDir": "/home/user/.local/share/nomnom", "usdaExists": false }
```

With `--download-usda`:
```json
{ "initialized": true, "dataDir": "/home/user/.local/share/nomnom", "usdaDownloaded": true }
```

`usdaError` (string) is included only when download fails.

**search \<query\>**
- `--limit <n>` - Max results (default: 10, max: 100)
- Auto-downloads USDA database if missing
- Returns custom foods first, then USDA results; `--limit` applies per source independently

```json
{
  "query": "big mac",
  "count": 2,
  "results": [
    {
      "source": "usda",
      "fdcId": 123456,
      "description": "Big Mac",
      "brand": "McDonald's",
      "barcode": "000000000000",
      "servingSize": "200g",
      "calories": 563,
      "protein": 25,
      "carbs": 46,
      "fat": 33,
      "fiber": 3,
      "sugar": 9,
      "sodium": 960
    }
  ]
}
```

Fields `brand`, `barcode`, `servingSize`, `fiber`, `sugar`, `sodium` may be `null`. Custom food results have `"source": "custom"` and `id` (UUID) instead of `fdcId`.

**lookup \<barcode\>**
- Checks custom foods first, then USDA
- Auto-downloads USDA database if missing

Found (USDA):
```json
{
  "found": true,
  "source": "usda",
  "fdcId": 123456,
  "description": "Quest Bar",
  "brand": "Quest Nutrition",
  "barcode": "00000000924665",
  "servingSize": "60g",
  "calories": 200,
  "protein": 21,
  "carbs": 22,
  "fat": 8,
  "fiber": 14,
  "sugar": 1,
  "sodium": 300
}
```

Custom food results have `"source": "custom"` and `id` (UUID) instead of `fdcId`.

Not found:
```json
{ "found": false, "barcode": "00000000924665" }
```

**log \<food\> [options]**
- `--qty <n>` - Quantity; supports decimals (default: 1)
- `--unit <u>` - Unit (default: serving)
- `--type <t>` - Meal type: breakfast/lunch/dinner/snack (default: snack)
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>`
- `--notes <text>`

```json
{ "success": true, "id": "uuid", "foodName": "Eggs", "quantity": 2 }
```

**delete \<id\>**

Delete a logged meal by its UUID.

```json
{ "success": true, "id": "uuid", "foodName": "Eggs" }
```

Error (meal not found): JSON error on stderr, exit 1.

**edit \<id\> [options]**
- `--food <name>` - Food name
- `--qty <n>` - Quantity
- `--unit <u>` - Unit
- `--type <t>` - Meal type
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>`
- `--notes <text>`

Read-merge-validate-write pattern: fetches existing meal, merges provided flags on top, validates (same rules as `log`), replaces row.

```json
{ "success": true, "id": "uuid", "foodName": "Eggs", "updated": ["calories", "fat"] }
```

No changes: `{ "success": true, "id": "uuid", "foodName": "Eggs", "updated": [] }`

Error (meal not found or invalid type): JSON error on stderr, exit 1.

**foods [subcommand]**

Manage custom foods stored in the meal database.

`foods add <name> [options]`
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>`
- `--fiber <n>`, `--sugar <n>`, `--sodium <n>`
- `--serving <text>` - Serving size description
- `--brand <text>` - Brand name
- `--barcode <text>` - Barcode

```json
{ "success": true, "id": "uuid", "name": "Huel Black" }
```

`foods list`

```json
{
  "count": 1,
  "foods": [{
    "id": "uuid",
    "name": "Huel Black",
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
  }]
}
```

`foods delete <id>`

```json
{ "success": true, "id": "uuid", "name": "Huel Black" }
```

Error (not found): JSON error on stderr, exit 1.

**today**

```json
{
  "date": "2026-02-21",
  "totals": { "calories": 500, "protein": 40, "carbs": 50, "fat": 20, "mealCount": 3 },
  "meals": [
    {
      "id": "uuid",
      "foodName": "Eggs",
      "quantity": 2,
      "unit": "serving",
      "mealType": "breakfast",
      "loggedAt": "2026-02-21 08:30:00",
      "notes": null,
      "calories": 140,
      "protein": 12,
      "carbs": 1,
      "fat": 10
    }
  ]
}
```

**history**
- `--limit <n>` - Max results (default: 20, max: 500)

```json
{ "count": 1, "meals": [{ "id": "uuid", "foodName": "...", "quantity": 1, "unit": "serving", "mealType": "snack", "loggedAt": "...", "notes": null, "calories": 100, "protein": 10, "carbs": 20, "fat": 5 }] }
```

Same meal object shape as `today`.

**config**
- `--set-data-dir <path>` - Set data directory
- `--set-usda-path <path>` - Set USDA database path
- `--reset` - Reset configuration to defaults

```json
{
  "config": {
    "dataDir": "/home/user/.local/share/nomnom",
    "mealDbPath": "/home/user/.local/share/nomnom/nomnom.db",
    "usdaDbPath": "/home/user/.local/share/nomnom/usda/usda_fdc.sqlite",
    "usdaExists": true
  },
  "paths": {
    "configDir": "/home/user/.config/nomnom",
    "defaultDataDir": "/home/user/.local/share/nomnom",
    "configFile": "/home/user/.config/nomnom/config.json"
  }
}
```

When setting a value: `{ "success": true, "dataDir": "/new/path" }` or `{ "success": true, "usdaPath": "/new/path" }`
When resetting: `{ "success": true }`

**goals [options]**
- `--calories <n>` - Daily calorie target
- `--protein <n>` - Daily protein target (g)
- `--carbs <n>` - Daily carbs target (g)
- `--fat <n>` - Daily fat target (g)
- `--<macro>-direction <d>` - Goal direction: `under` or `over` (default: calories/carbs/fat=under, protein=over)
- `--<macro>-tolerance <n>` - Tolerance percentage (0-100) for grace zone
- `--reset` - Clear all goals

Set goals:
```json
{ "success": true, "goalsSet": ["calories", "protein", "carbs", "fat"] }
```

View goals:
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

No goals set:
```json
{ "goals": null }
```

Reset:
```json
{ "success": true }
```

**progress [options]**
- `--date <n>` - Day offset (0=today, -1=yesterday)
- Requires goals to be set (exits with error if none)

```json
{
  "date": "2026-02-21",
  "goals": {
    "calories": { "target": 2000, "direction": "under", "tolerance": 10 },
    "protein": { "target": 120, "direction": "over", "tolerance": 15 }
  },
  "today": {
    "calories": { "actual": 1500, "goal": 2000, "remaining": 500, "percent": 75, "tolerance": 10, "band": 2200, "zone": "met" },
    "protein": { "actual": 95, "goal": 120, "remaining": 25, "percent": 79, "tolerance": 15, "band": 102, "zone": "near" },
    "mealCount": 3
  },
  "streaks": {
    "calories": { "current": 5, "best": 12, "direction": "under" },
    "protein": { "current": 3, "best": 8, "direction": "over" },
    "allGoals": { "current": 3, "best": 7 }
  },
  "weeklyAvg": {
    "calories": 1650.5,
    "protein": 102.3,
    "carbs": 180.1,
    "fat": 55.2,
    "daysTracked": 7
  }
}
```

Streak semantics:
- Streaks count consecutive days meeting the goal
- `direction: "under"` means actual <= target
- `direction: "over"` means actual >= target
- Days with no meals break the streak
- `allGoals` streak requires ALL goals to be met on each day

Tolerance/zone semantics:
- Tolerance is a percentage (0-100) per goal creating a grace zone
- `zone: "met"` means actual is on the correct side of the target
- `zone: "near"` means actual is within the grace zone (tolerance > 0 only)
- `zone: "over"` or `"under"` means actual missed the goal beyond the grace zone
- `band` is the computed edge of the grace zone
- Both "met" and "near" sustain streaks
- Tolerance defaults to 0 (no grace zone, binary met/missed behavior)

## Build & Development Commands

```bash
bun install                        # Install dev dependencies (@types/bun)
nomnom                             # Run CLI (installed via bunx/npm)
bun run dev                        # Run with watch mode
bun run typecheck                  # Run tsc --noEmit
bun run import:usda                # Import USDA data (requires ZIP download)
bun run smoke:goals                # Run goals/progress smoke test
bun run smoke:tolerance              # Run tolerance band smoke test
bun run smoke:crud                 # Run delete/edit/custom foods smoke test
npm publish                        # Publish to npm (requires npm login)
npm pack --dry-run                 # Preview published files
```

## Project Structure

```
src/
├── cli.ts                  # CLI entry point and command handlers
├── db.ts                   # SQLite database operations + config management
└── db/
    ├── build-compact.ts    # Build compact USDA database from full import
    └── usda-import.ts      # USDA data import script
~/.local/share/nomnom/      # Data directory (Linux/Mac)
├── nomnom.db               # Meal database
└── usda/
    └── usda_fdc.sqlite     # USDA food database
~/.config/nomnom/           # Config directory
└── config.json             # User configuration
%LOCALAPPDATA%/nomnom/      # Data directory (Windows)
%APPDATA%/nomnom/           # Config directory (Windows)
```

## Data Directory Paths

| Platform | Data | Config |
|----------|------|--------|
| Linux/Mac | `~/.local/share/nomnom/` or `$XDG_DATA_HOME/nomnom/` | `~/.config/nomnom/` or `$XDG_CONFIG_HOME/nomnom/` |
| Windows | `%LOCALAPPDATA%\nomnom\` | `%APPDATA%\nomnom\` |

Override with environment variables:
- `NOMNOM_DATA_DIR` - Override data directory
- `NOMNOM_CONFIG_DIR` - Override config directory
- `NOMNOM_USDA_URL` - Override USDA database download URL

## Code Style Guidelines

### TypeScript Configuration
- Target: ESNext with ES modules
- Strict mode enabled
- Run `bun run typecheck` before committing

### Naming Conventions
| Element | Convention | Example |
|---------|------------|---------|
| Files | `kebab-case` | `usda-import.ts` |
| Functions | `camelCase` | `searchFoods`, `getMealsByDate` |
| Types | `PascalCase` | `FoodResult`, `MealResult` |
| Constants | `SCREAMING_SNAKE` | `DATA_DIR`, `CONFIG_FILE` |
| DB columns | `snake_case` | `food_name`, `logged_at` |
| CLI output | `camelCase` | `foodName`, `loggedAt` |

### Formatting
- 2-space indentation
- Prefer explicit types for function parameters and return types

### Database Conventions
- SQLite with WAL mode
- FTS5 virtual table for food search
- `snake_case` in DB, `camelCase` in JSON output
- Custom foods table (`custom_foods`) and its FTS5 index are stored in the meal database (`nomnom.db`), not the USDA database

## USDA Database

The USDA food database (2M+ foods) is required for `search` and `lookup` commands. It is downloaded as a compressed `.sqlite.gz` from GitHub Releases.

**Auto-download (recommended):**
```bash
nomnom init --download-usda     # Explicit download
nomnom search "chicken"          # Auto-downloads on first search
```

**Manual import (advanced):**
```bash
# 1. Download CSV zip from https://fdc.nal.usda.gov/download-datasets/
# 2. Save to ~/.local/share/nomnom/usda/FoodData_Central_csv_<date>.zip
# 3. Run: bun run import:usda
```

Override download URL with `NOMNOM_USDA_URL` environment variable.

> **Note:** The first search after downloading builds an FTS5 index (one-time operation). A progress message is printed to stderr.

## Testing the CLI

```bash
# Test search (if USDA database exists)
nomnom search "big mac" --human

# Test logging
nomnom log "Test Food" --calories 100 --human

# Test logging with zero values (should show 0, not ?)
nomnom log "Zero Test" --calories 0 --protein 0 --human

# Test today's summary
nomnom today --human

# View configuration
nomnom config --human

# Test goals
nomnom goals --calories 2000 --protein 120 --human

# Test progress (requires goals + meal data)
nomnom progress --human

# Run goals smoke test
bun run smoke:goals

# Test tolerance
nomnom goals --calories 2000 --calories-tolerance 10 --human
nomnom progress --human

# Run tolerance smoke test
bun run smoke:tolerance

# Test custom foods
nomnom foods add "My Shake" --calories 400 --protein 30 --brand "Custom" --human
nomnom foods list --human
nomnom search "shake" --human   # Shows custom + USDA results with [source] tags

# Test delete
nomnom log "To Delete" --calories 100
# Copy the id from output
nomnom delete <id>

# Test edit
nomnom log "To Edit" --calories 100 --protein 10
# Copy the id from output
nomnom edit <id> --calories 200 --fat 15 --human

# Run CRUD smoke test
bun run smoke:crud
```

## Commit Guidelines

- Use imperative mood: "Add search command", "Fix barcode lookup"
- Run `bun run typecheck` before committing
- Never commit `data/` directory contents
