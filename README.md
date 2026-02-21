# NomNom Numbers

CLI-based nutrition tracking tool for AI agents. Search foods, log meals, and track macros - all outputting JSON for easy parsing.

## Installation

```bash
bun install
```

## Quick Start

```bash
# Initialize (auto-runs on first command if needed)
bun start init --human

# Search for foods
bun start search "chicken breast" --human

# Log a meal
bun start log "Grilled Chicken" --calories 165 --protein 31 --human

# View today's summary
bun start today --human

# View configuration
bun start config --human
```

## CLI Commands

All commands output JSON by default. Add `--human` or `-h` for readable format.

### init

Initialize the database. This runs automatically on first use.

```bash
bun start init                  # Initialize meal database
bun start init --download-usda  # Also download USDA food database (~200MB)
```

Returns:
```json
{
  "initialized": true,
  "dataDir": "/home/user/.local/share/nomnom",
  "usdaExists": true
}
```

### search \<query\>

Search USDA food database (2M+ foods). Auto-downloads database on first use.

```bash
bun start search "big mac" --limit 5
bun start search "quest bar" --human
```

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
      "calories": 563,
      "protein": 25,
      "carbs": 46,
      "fat": 33
    }
  ]
}
```

### lookup \<barcode\>

Look up a food by barcode (UPC/EAN).

```bash
bun start lookup 00000000924665
```

### log \<food\> [options]

Log a meal entry.

Options:
- `--qty <n>` - Quantity (default: 1)
- `--unit <u>` - Unit (default: serving)
- `--type <t>` - Meal type: breakfast/lunch/dinner/snack
- `--calories <n>`, `--protein <n>`, `--carbs <n>`, `--fat <n>`
- `--notes <text>`

```bash
bun start log "Eggs" --qty 2 --calories 140 --protein 12 --type breakfast
```

### today

Show today's meals and totals.

```bash
bun start today --human
```

### history [options]

Show meal history.

Options:
- `--limit <n>` - Max results (default: 20)

```bash
bun start history --limit 10 --human
```

### config [options]

View or modify configuration.

Options:
- `--set-data-dir <path>` - Set data directory
- `--set-usda-path <path>` - Set USDA database path

```bash
bun start config --human
bun start config --set-data-dir /custom/path
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

The USDA food database (2M+ foods, ~200MB) is required for `search` and `lookup` commands.

**Auto-download (recommended):**
```bash
bun start search "chicken"  # Auto-downloads on first use
```

**Manual download:**
```bash
bun start init --download-usda
```

**Advanced: Import from CSV**
1. Download CSV zip from https://fdc.nal.usda.gov/download-datasets/
2. Save to `~/.local/share/nomnom/usda/FoodData_Central_csv_2025-12-18.zip`
3. Run `bun run import:usda`

## For AI Agents

This tool is designed to be called by AI agents. All output is JSON by default, making it easy to parse programmatically.

```bash
# AI agent calls this CLI
result=$(bun start search "chicken breast" --limit 3)
# Parse JSON result with jq or similar
```

## License

MIT
