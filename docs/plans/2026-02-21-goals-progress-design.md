# Goals & Progress System Design

## Problem

An agent tracking nutrition needs to: (1) analyze historical eating patterns, (2) set daily targets based on that analysis, and (3) check progress on future visits. The CLI currently supports logging and querying meals but has no concept of goals, streaks, or progress comparison.

## Solution

Two new CLI commands: `goals` (CRUD for daily targets) and `progress` (single-call dashboard for agent consumption). Goals stored in SQLite alongside meal data. Streaks computed on-the-fly by walking history backwards.

---

## New Commands

### `goals` — Set and view daily targets

```bash
bun start goals                                              # View current goals
bun start goals --calories 2000 --protein 120 --carbs 250 --fat 65  # Set goals
bun start goals --reset                                      # Clear all goals
```

Each macro has a **direction** controlling how success is measured:
- `under` — success when actual <= target (default for calories, carbs, fat)
- `over` — success when actual >= target (default for protein)

Override with: `bun start goals --protein 120 --protein-direction over`

**JSON output (view):**
```json
{
  "goals": {
    "calories": { "target": 2000, "direction": "under" },
    "protein": { "target": 120, "direction": "over" },
    "carbs": { "target": 250, "direction": "under" },
    "fat": { "target": 65, "direction": "under" },
    "updatedAt": "2026-02-21 14:30:00"
  }
}
```

No goals set: `{ "goals": null }`

**JSON output (set):**
```json
{ "success": true, "goalsSet": ["calories", "protein", "carbs", "fat"] }
```

**JSON output (reset):**
```json
{ "success": true }
```

### `progress` — Full dashboard for agent consumption

```bash
bun start progress              # Today's progress
bun start progress --date -1    # Yesterday's progress
```

**JSON output:**
```json
{
  "date": "2026-02-21",
  "goals": {
    "calories": { "target": 2000, "direction": "under" },
    "protein": { "target": 120, "direction": "over" },
    "carbs": { "target": 250, "direction": "under" },
    "fat": { "target": 65, "direction": "under" }
  },
  "today": {
    "calories": { "actual": 1624.5, "goal": 2000, "remaining": 375.5, "percent": 81 },
    "protein": { "actual": 77, "goal": 120, "remaining": 43, "percent": 64 },
    "carbs": { "actual": 138.7, "goal": 250, "remaining": 111.3, "percent": 55 },
    "fat": { "actual": 74.1, "goal": 65, "remaining": -9.1, "percent": 114 },
    "mealCount": 4
  },
  "streaks": {
    "calories": { "current": 0, "best": 5, "direction": "under" },
    "protein": { "current": 3, "best": 7, "direction": "over" },
    "allGoals": { "current": 0, "best": 2 }
  },
  "weeklyAvg": {
    "calories": 1556,
    "protein": 79.6,
    "carbs": 160.3,
    "fat": 58.6,
    "daysTracked": 7
  }
}
```

When no goals are set: `{ "error": "No goals set. Use 'nomnom goals --calories 2000 ...' to set goals." }` (exit 1)

**Field semantics:**
- `remaining` — positive = room left, negative = exceeded. For `direction: "under"`, negative means you went over (bad). For `direction: "over"`, negative means you exceeded your target (good).
- `percent` — integer, `round(actual / goal * 100)`. Can exceed 100.
- `streaks.current` — consecutive days ending at the requested date where the goal was met.
- `streaks.best` — longest streak found in the full history.
- `streaks.allGoals` — consecutive days where ALL individual goals were met simultaneously.
- `weeklyAvg` — rolling 7-day average ending on the requested date.
- `daysTracked` — number of days in the 7-day window that have at least 1 meal logged.

**Human-readable output (`--human`):**
```
Progress for 2026-02-21

Calories: 1624.5 / 2000  (81%) ■■■■■■■■░░ 375.5 remaining
Protein:   77.0 / 120    (64%) ■■■■■■░░░░  43.0 remaining
Carbs:    138.7 / 250    (55%) ■■■■■░░░░░ 111.3 remaining
Fat:       74.1 / 65    (114%) ■■■■■■■■■■  OVER by 9.1

Streaks:  cal 0d (best 5d) | pro 3d (best 7d) | all 0d (best 2d)

7-day avg: 1556 cal | 79.6p 160.3c 58.6f (7 days tracked)
```

---

## Database Schema

New table in `nomnom.db`:

```sql
CREATE TABLE IF NOT EXISTS goals (
  key TEXT PRIMARY KEY,
  target REAL NOT NULL,
  direction TEXT NOT NULL DEFAULT 'under',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Valid `key` values: `calories`, `protein`, `carbs`, `fat`.
Valid `direction` values: `under`, `over`.

---

## Streak Calculation Algorithm

Computed at query time (not stored). For each macro with a goal:

1. Starting from the requested date, walk backwards one day at a time.
2. For each day, get daily totals via `getDailyTotals(date)`.
3. Check if the goal was met:
   - `direction: "under"` → actual <= target
   - `direction: "over"` → actual >= target
4. If day has 0 meals logged, the streak breaks (skip days aren't counted as hits).
5. Count consecutive passing days = `current` streak.
6. For `best` streak, scan the entire history range (earliest logged meal to requested date).

The `allGoals` streak requires ALL individual goals to pass on the same day.

Performance: Walking 500 days with 4 SQL queries per day is ~2000 queries. With SQLite WAL mode and indexed `logged_at`, this completes in <100ms. For the `best` streak scan, we can optimize by fetching all daily totals in one query with `GROUP BY date(logged_at)`.

---

## Validation

- `goals` command: at least one macro flag required when setting (error if none provided).
- `--direction` values must be `under` or `over` (error otherwise).
- `progress --date` uses the same offset logic as `today --date`.
- Goals can be partially set (e.g. only calories and protein). Progress only shows macros that have goals.

---

## Files Affected

- `src/db.ts` — New functions: `setGoals()`, `getGoals()`, `resetGoals()`, `getAllDailyTotals()`, goals table init
- `src/cli.ts` — New command handlers for `goals` and `progress`
- `AGENTS.md` — Document new commands
- `scripts/smoke-test-month.ts` — Extend to test goals + progress after seeding
