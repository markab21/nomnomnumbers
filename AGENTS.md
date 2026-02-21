# AGENTS.md - Coding Agent Guidelines

## Project Overview

NomNom Numbers is a CLI-based nutrition tracking tool for AI agents. It provides food search via USDA SQLite with FTS5, barcode lookup, and meal logging - all outputting JSON for easy parsing by AI tools.

## CLI Commands

```bash
bun start help                    # Show all commands
bun start init                    # Initialize database (auto-runs on first use)
bun start search "chicken breast" # Search foods (JSON output)
bun start lookup 00000000924665   # Lookup by barcode
bun start log "eggs" --calories 150 --protein 12  # Log a meal
bun start today                   # Today's summary
bun start history --limit 10      # Meal history
bun start config                  # View configuration
```

All commands output JSON by default. Add `--human` or `-h` for readable format.

### Command Details

**init**
- `--download-usda` - Download USDA food database (~200MB)
- Auto-runs on first use if database doesn't exist
- Returns: `{ initialized: true, dataDir, usdaExists }`

**search <query>**
- `--limit <n>` - Max results (default: 10)
- Auto-downloads USDA database if missing (~200MB)
- Returns: `{ query, count, results: [...] }`

**lookup <barcode>**
- Auto-downloads USDA database if missing (~200MB)
- Returns: `{ found: boolean, ...foodData }` or `{ found: false, barcode }`

**log <food> [options]**
- `--qty <n>` - Quantity (default: 1)
- `--unit <u>` - Unit (default: serving)
- `--type <t>` - Meal type: breakfast/lunch/dinner/snack
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>`
- `--notes <text>`
- Returns: `{ success: true, id, foodName, quantity }`

**today**
- Returns: `{ date, totals: { calories, protein, carbs, fat, mealCount }, meals: [...] }`

**history**
- `--limit <n>` - Max results (default: 20)
- Returns: `{ count, meals: [...] }`

**config**
- `--set-data-dir <path>` - Set data directory
- `--set-usda-path <path>` - Set USDA database path
- Returns: `{ config: {...}, paths: {...} }`

## Build & Development Commands

```bash
bun install                        # Install dependencies (none required)
bun start                          # Run CLI
bun run dev                        # Run with watch mode
bun run typecheck                  # Run tsc --noEmit
bun run import:usda                # Import USDA data (requires ZIP download)
```

## Project Structure

```
src/
├── cli.ts                  # CLI entry point and command handlers
├── db.ts                   # SQLite database operations + config management
└── db/
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

## USDA Database

The USDA food database (2M+ foods) is required for `search` and `lookup` commands.

**Auto-download (recommended):**
```bash
bun start init --download-usda     # Explicit download
bun start search "chicken"          # Auto-downloads on first search
```

**Manual import (advanced):**
```bash
# 1. Download CSV zip from https://fdc.nal.usda.gov/download-datasets/
# 2. Save to ~/.local/share/nomnom/usda/FoodData_Central_csv_2025-12-18.zip
# 3. Run: bun run import:usda
```

Override download URL with `NOMNOM_USDA_URL` environment variable.

## Testing the CLI

```bash
# Test search (if USDA database exists)
bun start search "big mac" --human

# Test logging
bun start log "Test Food" --calories 100 --human

# Test today's summary
bun start today --human

# View configuration
bun start config --human
```

## Commit Guidelines

- Use imperative mood: "Add search command", "Fix barcode lookup"
- Run `bun run typecheck` before committing
- Never commit `data/` directory contents
