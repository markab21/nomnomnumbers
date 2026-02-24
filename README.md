# NomNom Numbers

The memory and brains behind agentic nutrition tracking. 

NomNom Numbers is a headless, CLI-based nutrition backend designed specifically to be consumed by AI agents (like Claude Desktop) via MCP. It handles the complex data modeling, USDA database searches, macro tracking, and gamification logic, providing a clean, deterministic JSON interface for your AI frontend.

## Installation & Usage

NomNom is built with [Bun](https://bun.sh/). The easiest way to use it is directly via `bunx`:

```bash
# Run directly without installing
bunx nomnomnumbers --help
```

To install globally so it's always available as `nomnom`:

```bash
bun install -g nomnomnumbers
```

*(If cloning the repo for development, use `bun install` and run via `bun start <command>`)*

## Quick Start

```bash
# Initialize database (auto-runs on first command if needed)
bunx nomnomnumbers init --human

# Search for foods
bun start search "chicken breast" --human

# Log a meal
bun start log "Grilled Chicken" --calories 165 --protein 31 --human

# View today's summary
bun start today --human

# View configuration
bunx nomnomnumbers config --human
```

## CLI Commands

All commands output JSON to **stdout** by default. Add `--human` or `-h` after a command for readable format.

> **Note:** Use `-h` after a command name for help, e.g., `bunx nomnomnumbers today -h`.

### Output Format

| Stream | Content |
|--------|---------|
| **stdout** | JSON result (or human-readable text with `--human`) |
| **stderr** | Errors, progress messages, initialization notices |

- **Exit code 0** — success; parse stdout as JSON
- **Exit code 1** — error; stderr contains `{ "error": "message" }`

Errors are always JSON on stderr, even in `--human` mode:
```json
{ "error": "Usage: nomnom search <query>" }
```

Flags support both `--flag value` and `--flag=value` syntax. Negative numeric values are accepted (e.g. `--calories -50`).

### init

Initialize the database. This runs automatically on first use.

```bash
bun start init                  # Initialize meal database
bun start init --download-usda  # Also download USDA food database
```

Returns:
```json
{
  "initialized": true,
  "dataDir": "/home/user/.local/share/nomnom",
  "usdaExists": true
}
```

With `--download-usda`:
```json
{
  "initialized": true,
  "dataDir": "/home/user/.local/share/nomnom",
  "usdaDownloaded": true
}
```

`usdaError` (string) is included only when download fails.

### search \<query\>

Search USDA food database (2M+ foods). Auto-downloads database on first use.

```bash
bunx nomnomnumbers search "big mac" --limit 5
bunx nomnomnumbers search "quest bar" --human
```

Options:
- `--limit <n>` - Max results (default: 10, max: 100)

Returns:
```json
{
  "query": "big mac",
  "count": 5,
  "results": [
    {
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

Fields `brand`, `barcode`, `servingSize`, `fiber`, `sugar`, `sodium` may be `null`.

### lookup \<barcode\>

Look up a food by barcode (UPC/EAN). Auto-downloads USDA database on first use.

```bash
bunx nomnomnumbers lookup 00000000924665
```

Returns (found):
```json
{
  "found": true,
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

Returns (not found):
```json
{ "found": false, "barcode": "00000000924665" }
```

### log \<food\> [options]

Log a meal entry.

Options:
- `--qty <n>` - Quantity; supports decimals (default: 1)
- `--unit <u>` - Unit (default: serving)
- `--type <t>` - Meal type: breakfast/lunch/dinner/snack (default: snack)
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>`
- `--notes <text>`

```bash
bunx nomnomnumbers log "Eggs" --qty 2 --calories 140 --protein 12 --type breakfast
bunx nomnomnumbers log "Olive Oil" --qty 1.5 --unit tbsp --calories 180 --fat 21
```

Returns:
```json
{ "success": true, "id": "uuid", "foodName": "Eggs", "quantity": 2 }
```

### delete \<id\>

Delete a logged meal by its ID.

```bash
bunx nomnomnumbers delete "uuid"
```

Returns:
```json
{ "success": true, "id": "uuid", "foodName": "Eggs" }
```

### edit \<id\> [options]

Edit a logged meal entry. Only provided flags are updated.

Options:
- `--food <name>` - Update food name
- `--qty <n>` - Update quantity
- `--unit <u>` - Update unit
- `--type <t>` - Update meal type
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>`
- `--notes <text>`

```bash
bunx nomnomnumbers edit "uuid" --qty 3 --notes "Extra hungry"
```

Returns:
```json
{ "success": true, "id": "uuid", "foodName": "Eggs", "updated": ["quantity", "notes"] }
```

### foods [subcommand]

Manage custom foods (items not in USDA database).

Subcommands:
- `add <name> [options]` - Add a custom food (supports macros, serving size, brand, barcode)
- `list` - List all custom foods
- `delete <id>` - Delete a custom food

```bash
bunx nomnomnumbers foods add "My Secret Recipe" --calories 400 --protein 30
bunx nomnomnumbers foods list --human
bunx nomnomnumbers foods delete "uuid"
```

### today

Show today's meals and totals.

```bash
bunx nomnomnumbers today --human
```

Returns:
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

When goals are set (via `goals` command), `today` also includes:
```json
{
  "goals": { "calories": 2000, "protein": 150 },
  "remaining": { "calories": 600, "protein": 50 }
}
```

### history [options]

Show meal history.

Options:
- `--limit <n>` - Max results (default: 20, max: 500)
- `--offset <n>` - Skip first N results for pagination (default: 0)

```bash
bunx nomnomnumbers history --limit 10 --human
bunx nomnomnumbers history --limit 50 --offset 50  # page 2
```

Returns the same meal object shape as `today`. Response: `{ "count": N, "offset": 0, "meals": [...] }`

### trends [options]

Show nutrition trends over time, pre-computed for AI agents.

Options:
- `--days <n>` - Number of days to analyze (default: 7, max: 90)

```bash
bunx nomnomnumbers trends --days 7
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

### goals [options]

View or set daily nutrition goals.

Options:
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>` - Set targets
- `--<macro>-direction <d>` - Goal direction: `under` or `over`
- `--<macro>-tolerance <n>` - Tolerance percentage (0-100)
- `--reset` - Clear all goals

```bash
bunx nomnomnumbers goals --calories 2000 --protein 150 --protein-direction over
```

Returns:
```json
{
  "success": true,
  "goalsSet": ["calories", "protein"]
}
```

### progress [options]

Show gamification progress vs goals, streaks, and weekly averages.

Options:
- `--date <n>` - Day offset (0=today, -1=yesterday)

```bash
bunx nomnomnumbers progress --human
```

Returns detailed JSON with today's progress, goal streaks, and a 7-day rolling average.

### config [options]

View or modify configuration.

Options:
- `--set-data-dir <path>` - Set data directory
- `--set-usda-path <path>` - Set USDA database path
- `--reset` - Reset configuration to defaults

```bash
bunx nomnomnumbers config --human
bunx nomnomnumbers config --set-data-dir /custom/path
bunx nomnomnumbers config --reset
```

Returns:
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

### mcp

Start the Model Context Protocol (MCP) server for NomNom Numbers (stdio transport). Connect AI agents directly to the tools provided by the CLI.

```bash
bunx nomnomnumbers mcp
```

## Data Storage

### Default Paths

| Platform | Data | Config |
|----------|------|--------|
| Linux/Mac | `~/.local/share/nomnom/` | `~/.config/nomnom/` |
| Windows | `%LOCALAPPDATA%\nomnom\` | `%APPDATA%\nomnom\` |

### Environment Variables

Override default paths:
- `NOMNOM_DATA_DIR` - Data directory
- `NOMNOM_CONFIG_DIR` - Config directory
- `NOMNOM_USDA_URL` - Custom USDA database download URL

## USDA Database

The USDA food database (2M+ foods) is required for `search` and `lookup` commands. It is downloaded as a compressed `.sqlite.gz` from GitHub Releases.

**Auto-download (recommended):**
```bash
bunx nomnomnumbers search "chicken"  # Auto-downloads on first use
```

**Manual download:**
```bash
bunx nomnomnumbers init --download-usda
```

**Advanced: Import from CSV**
1. Download CSV zip from https://fdc.nal.usda.gov/download-datasets/
2. Save to `~/.local/share/nomnom/usda/FoodData_Central_csv_<date>.zip`
3. Run `bun run import:usda`

> **Note:** The first search after downloading builds an FTS5 index (one-time operation). A progress message is printed to stderr.

## Integrating with AI Agents (OpenClaw, Claude Desktop)

NomNom Numbers is designed specifically to be the memory and brains behind autonomous agent frameworks like **OpenClaw** or **Claude Desktop**. 

Because OpenClaw can autonomously run shell commands, interact with local files, and hook into messaging apps (WhatsApp, Telegram, etc.), NomNom Numbers provides the perfect deterministic backend for it to track your nutrition without hallucinating data.

### OpenClaw Integration Guide

Since OpenClaw executes shell commands natively, you do not need complex API integrations. Just instruct your OpenClaw agent to use `bunx nomnomnumbers`.

1. **Install OpenClaw** and configure it to run on your local machine or a secure server.
2. **Give OpenClaw its system prompt / instructions:**
   Tell OpenClaw it has access to a nutrition CLI. Example prompt addition:
   > *"You are my nutrition assistant. You must rigorously track my macros and calories using the `nomnomnumbers` CLI. To log a meal, run `bunx nomnomnumbers log <food> --calories <c> --protein <p>`. To check my daily remaining goals, run `bunx nomnomnumbers today`. Rely EXCLUSIVELY on the JSON output from this tool to answer my nutrition questions."*
3. **Message OpenClaw:** *"I just ate a Big Mac, log it and tell me how my protein looks today."*
4. **OpenClaw autonomously executes:**
   - `bunx nomnomnumbers search "Big Mac" --limit 1`
   - `bunx nomnomnumbers log "Big Mac" --calories 563 --protein 25`
   - `bunx nomnomnumbers today`
   - OpenClaw parses the JSON and replies to you via WhatsApp/Slack.

### Key Features for Agents

- **stdout** contains clean JSON (parseable as-is by the LLM)
- **stderr** contains errors, progress, and status messages (never mixed into stdout)
- **Exit code 0** means success; **exit code 1** means error
- Errors on stderr are JSON: `{ "error": "message" }`
- Invalid numeric flags (NaN) are silently ignored; invalid `--limit` values use the default
- Invalid `--type` values produce a JSON error

```bash
# Capture only stdout (JSON result); stderr goes to terminal/logs
result=$(bunx nomnomnumbers search "chicken breast" --limit 3)

# Check exit code
if bunx nomnomnumbers lookup "$BARCODE" > /tmp/result.json 2>/tmp/err.json; then
  # Parse /tmp/result.json
else
  # Parse /tmp/err.json for error message
fi
```

### Model Context Protocol (MCP)

If you are using **Claude Desktop** or an MCP-compatible framework, NomNom Numbers includes a built-in MCP server.

Add this to your `claude_desktop_config.json`:
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

## License

MIT
