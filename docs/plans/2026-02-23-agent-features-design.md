# Agent-Facing Features: Trends, Pagination, Unified Goals

**Date**: 2026-02-23
**Status**: Approved
**Est. Effort**: 0.5 day (~80 LOC)

## Overview

Three additions to make NomNom more useful for AI agents (MCP consumers): a `trends` command for pre-computed time-series data, `--offset` pagination for `history`, and unified goals integration with the macro bar filler gamification system.

## Design Decisions

- **Targets unified with gamification goals** — no separate goal system. The `daily_bars` table from the macro bar filler *is* the source of truth for nutrition targets.
- **`--offset` over date-range filtering** — agents work in chunks, not human-readable date ranges. Simpler, more deterministic.
- **Trends return averages + daily breakdown** — agents need both the summary (for quick answers) and per-day data (for anomaly detection).

## Feature 1: `trends` Command

Pre-compute nutrition trends so agents don't parse raw history.

### CLI

```bash
bun start trends --days 7
bun start trends --days 30 --human
```

### JSON Output

```json
{
  "days": 7,
  "period": { "from": "2026-02-16", "to": "2026-02-22" },
  "averages": { "calories": 2100, "protein": 145, "carbs": 190, "fat": 55 },
  "daily": [
    { "date": "2026-02-16", "calories": 1900, "protein": 130, "carbs": 180, "fat": 50, "mealCount": 3 },
    { "date": "2026-02-17", "calories": 2300, "protein": 160, "carbs": 200, "fat": 60, "mealCount": 4 }
  ]
}
```

### Implementation

- New `getTrendData(days: number)` in `db.ts` — queries meal log grouped by date for the last N days, computes per-day totals and averages.
- New `case "trends"` in `cli.ts` — parses `--days` flag (default 7, max 90), calls `getTrendData`, formats output.
- Human output: table with daily totals and averages row.

## Feature 2: `--offset` for `history`

### CLI

```bash
bun start history --limit 50 --offset 0
bun start history --limit 50 --offset 50
```

### JSON Output

Same shape as current `history`, adds `"offset": N` field.

### Implementation

- Add `offset` parameter to `getMealHistory(limit, offset)` in `db.ts` — appends `OFFSET ?` to SQL.
- Parse `--offset` flag in CLI handler (default 0, must be non-negative int).

## Feature 3: Unified Goals in `today`

### JSON Output (enhanced)

```json
{
  "date": "2026-02-22",
  "totals": { "calories": 1400, "protein": 100, "carbs": 150, "fat": 40 },
  "goals": { "calories": 2200, "protein": 150, "carbs": 200, "fat": 60 },
  "remaining": { "calories": 800, "protein": 50, "carbs": 50, "fat": 20 },
  "meals": [...]
}
```

### Implementation

- In the `today` CLI handler, after computing totals, query `daily_bars` for today's goals.
- Compute `remaining = goals - totals` (floor at 0).
- Only include `goals`/`remaining` if gamification tables exist (graceful fallback).

## Testing

### Automated

```bash
bun test
```

- Unit tests for `getTrendData()` with known meal data in an in-memory DB.
- Unit test for `getMealHistory()` with offset parameter.
- CLI integration tests for `trends` and `history --offset`.

### Manual

```bash
# Log some meals, then:
bun start trends --days 7
bun start trends --days 7 --human
bun start history --limit 2 --offset 0
bun start history --limit 2 --offset 2
bun start today  # verify goals/remaining appear
```
