# NomNom Numbers

**Agentic nutrition tracking for weight loss.** NomNom is a CLI and MCP server that gives AI agents a reliable, deterministic way to track what you eat, monitor your macros, and help you hit your goals.

## Why NomNom?

You want an AI assistant to help manage your nutrition. But AI agents hallucinate. They forget what you ate yesterday. They make up numbers.

NomNom solves this by being the **source of truth**:
- AI agents log meals → NomNom stores them in SQLite
- AI agents query status → NomNom returns exact JSON
- No ambiguity, no hallucination, no lost data

**Real example workflow:**

```
You (to Claude via MCP): "I just had two scrambled eggs and toast"
Claude: Calls nomnom search "scrambled eggs" → finds 140 cal, 12g protein
        Calls nomnom log "Scrambled Eggs" --qty 2 --calories 140 --protein 12
        Returns: "Logged! You're at 850/2000 cal, 65/150g protein today"

You: "How am I doing this week?"
Claude: Calls nomnom trends --days 7
        Returns: "Avg 1850 cal/day, hitting protein goals 5/7 days. On track!"
```

## Installation

```bash
# Run directly (recommended for AI agents)
bunx nomnomnumbers --help

# Or install globally
bun install -g nomnomnumbers
nomnom --help
```

## Core Commands

### Search & Log Meals

```bash
# Search 2M+ USDA foods
nomnom search "chicken breast" --limit 5

# Log by name (AI can search then log)
nomnom log "Chicken Breast" --qty 1 --calories 165 --protein 31

# Log by barcode
nomnom lookup 00000000924665
nomnom log "Quest Bar" --calories 200 --protein 21
```

### Track Progress

```bash
# Today's summary
nomnom today --human

# Set goals
nomnom goals --calories 2000 --protein 150

# Progress vs goals (includes streaks!)
nomnom progress --human
```

### History & Trends

```bash
# Recent meals
nomnom history --limit 10 --human

# Weekly trends (AI uses this for insights)
nomnom trends --days 7
```

## AI Integration

### MCP (Claude Desktop, etc.)

Add to `claude_desktop_config.json`:

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

Then Claude can:
- Log meals you mention in conversation
- Track your progress over time
- Give insights based on your actual data

**Example Claude prompt:**
> "Track my nutrition using the nomnom MCP tool. When I tell you what I ate, log it. When I ask how I'm doing, check my progress. Be proactive about keeping me on track."

### CLI (Any AI Agent)

AI agents that can run shell commands can use NomNom directly:

```bash
# All output is JSON for easy parsing
result=$(nomnom today)

# Exit code 0 = success, 1 = error
# stdout = JSON result
# stderr = errors/progress (never mixed)
```

## Output Format

| Stream | Content |
|--------|---------|
| stdout | JSON result (add `--human` for readable) |
| stderr | Errors, progress, initialization |
| Exit 0 | Success |
| Exit 1 | Error (stderr has `{ "error": "..." }`) |

## All Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize database (auto-runs) |
| `search <query>` | Search USDA foods |
| `lookup <barcode>` | Look up by barcode |
| `log <food> [options]` | Log a meal |
| `delete <id>` | Delete a meal |
| `edit <id> [options]` | Edit a meal |
| `today` | Today's summary |
| `history` | Meal history |
| `trends` | Nutrition trends |
| `goals` | Set/view goals |
| `progress` | Progress vs goals |
| `foods add/list/delete` | Manage custom foods |
| `config` | View/modify config |
| `mcp` | Start MCP server |

Run `nomnom help` for full details.

## Data Storage

| Platform | Data |
|----------|------|
| Linux/Mac | `~/.local/share/nomnom/` |
| Windows | `%LOCALAPPDATA%\nomnom\` |

Override with `NOMNOM_DATA_DIR` environment variable.

## Example: Agentic Weight Loss Workflow

**Day 1 - Setup:**
```
You: "I want to lose weight. My goal is 1800 calories, 140g protein."
Claude: nomnom goals --calories 1800 --protein 140
        "Goals set! I'll track your meals and keep you accountable."
```

**Day 5 - Tracking:**
```
You: "Had a turkey sandwich for lunch"
Claude: nomnom search "turkey sandwich"
        nomnom log "Turkey Sandwich" --calories 350 --protein 25
        "Logged! You're at 1200/1800 cal, 95/140g protein. 600 cal to go!"
```

**Day 12 - Check-in:**
```
You: "How am I doing?"
Claude: nomnom trends --days 7
        nomnom progress
        "Great week! Avg 1750 cal/day, hitting protein 6/7 days. 
         7-day streak on calories! Keep it up."
```

**Day 30 - Insights:**
```
You: "What patterns do you see?"
Claude: [Analyzes 30 days of data via nomnom history/trends]
        "You hit protein goals 85% of days you ate breakfast.
         On days you missed breakfast, avg calories were 2100 (over goal).
         Recommendation: Don't skip breakfast."
```

## License

MIT
