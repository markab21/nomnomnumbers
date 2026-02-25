# NomNom Numbers: Macro Bar Filler - Design Document

**Date**: 2026-02-23
**Status**: Approved
**Est. Effort**: 1 day (~150 LOC)

## Overview

Transform NomNom from a passive meal logger into a gamified nutrition tracker using incremental/idle game mechanics inspired by Cookie Clicker. The core loop is dead simple: **Log meal → Bars fill → Victory → Streak compounds → Buy Reducer → Goals easier → Snowball**.

## Design Principles

1. **Minimal complexity** - One loop, one metric, one upgrade path
2. **Parabolic progression** - Slow start, exponential growth
3. **Pure numbers** - No subjective data (mood, feelings), just macros
4. **AI-friendly** - JSON output, MCP endpoints for agent integration
5. **Testable** - Simulation harness validates mechanics

## Core Loop

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. LOG MEAL                                                │
│     nomnom log --protein 30 --carbs 50 --fat 15 --cal 450   │
│     → 4 daily bars fill (P/C/F/Cal vs goals)                │
│                                                             │
│  2. HIT 100% ON ALL BARS                                    │
│     → Victory! (+1 victory, streak++ if consecutive)        │
│                                                             │
│  3. STREAK COMPOUNDS                                        │
│     Streak=5 → +5% bonus on all future logs                 │
│                                                             │
│  4. BUY REDUCER (ONE upgrade)                               │
│     Cost: 5 × (level + 1) victories                         │
│     Effect: Goals drop 5g → easier to hit → more victories  │
│                                                             │
│  5. SNOWBALL                                                │
│     Lower goals + streak bonus = exponential victory growth │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Visual Output

```
$ nomnom status
Daily Bars:
P:   80/145 [█████░░░░░] 55%
C:  120/195 [██████░░░░] 62%
F:   35/57  [█████▌░░░░] 61%
Cal:1400/2150 [██████░░░░] 65%

Streak: 4 🔥 (+4% log bonus)
Total Victories: 27
Reducer Lvl: 1 (goals reduced by 5g)
Next Reducer: 10 Victories
```

## Data Model

### Schema (2 tables)

```sql
-- Daily progress (1 row per day)
CREATE TABLE daily_bars (
  date TEXT PRIMARY KEY,              -- YYYY-MM-DD
  p_logged REAL DEFAULT 0,
  p_goal REAL DEFAULT 150,
  c_logged REAL DEFAULT 0,
  c_goal REAL DEFAULT 200,
  f_logged REAL DEFAULT 0,
  f_goal REAL DEFAULT 60,
  cal_logged REAL DEFAULT 0,
  cal_goal REAL DEFAULT 2200,
  victory BOOLEAN DEFAULT FALSE,
  streak_bonus REAL DEFAULT 0         -- Copied from previous day's streak
);

-- Lifetime stats (single row)
CREATE TABLE lifetime_stats (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_victories INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  reducer_lvl INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- View for status display
CREATE VIEW status_view AS
SELECT 
  date,
  ROUND((p_logged / p_goal) * 100, 1) as p_pct,
  ROUND((c_logged / c_goal) * 100, 1) as c_pct,
  ROUND((f_logged / f_goal) * 100, 1) as f_pct,
  ROUND((cal_logged / cal_goal) * 100, 1) as cal_pct
FROM daily_bars 
WHERE date = date('now');
```

### Default Goals

| Macro | Default Goal | Reducer Effect |
|-------|-------------|----------------|
| Protein | 150g | -5g per level |
| Carbs | 200g | -5g per level |
| Fat | 60g | -3g per level |
| Calories | 2200 | -50 per level |

## Gamification Mechanics

### Bar Fill Formula
```
effective_log = raw_log × (1 + streak_bonus)
streak_bonus = current_streak × 0.04  -- 4% per streak day
```

Example: Streak=5, log 30g protein → 30 × 1.20 = 36g logged

### Victory Condition
All 4 bars must be ≥100% at time of `victory-check`

### Streak Logic
- Consecutive victory days increment streak
- Miss a day → streak resets to 0
- Streak bonus applies to NEXT day (copied at reset)

### Reducer Mechanics
```
cost = 5 × (reducer_lvl + 1)  -- Level 1: 5, Level 2: 10, Level 3: 15...

effect_per_level:
  p_goal -= 5
  c_goal -= 5
  f_goal -= 3
  cal_goal -= 50
```

### Parabolic Progression Example

| Days | Reducer Lvl | Protein Goal | Victories/Day | Why |
|------|-------------|--------------|---------------|-----|
| 1-5 | 0 | 150g | 1/day | Manual fill |
| 6-10 | 1 | 145g | 1-2/day | First reducer |
| 11-20 | 2 | 140g | 2-3/day | + streak bonus |
| 21-30 | 4 | 130g | 3-5/day | Snowball effect |
| 60+ | 10+ | 100g | 5+/day | Easy wins |

## CLI Commands

### Log Meal
```bash
nomnom log --protein 30 --carbs 50 --fat 15 --calories 450
# Short form:
nomnom log -p 30 -c 50 -f 15 -l 450
```

Output:
```json
{
  "success": true,
  "logged": {"protein": 36, "carbs": 60, "fat": 18, "calories": 540},
  "bonus_applied": "20%",
  "daily_totals": {"protein": 116, "carbs": 180, "fat": 53, "calories": 1940}
}
```

### Status
```bash
nomnom status
# Human: ASCII bars
# JSON: {"bars": {...}, "streak": 4, "victories": 27, "reducer_lvl": 1}
```

### Victory Check
```bash
nomnom victory-check
# Auto-runs at midnight or manual trigger
# Checks if all bars ≥100%, awards victory if so
```

### Buy Reducer
```bash
nomnom buy-reducer
# Spends victories, lowers goals
```

### Reset Day
```bash
nomnom reset-day
# Creates new day row, copies streak bonus
# Auto-runs at midnight
```

### Simulation
```bash
nomnom sim 30
# Runs 30 simulated days with random meal data
# Validates parabolic progression
```

## MCP Integration

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/log` | POST | Log meal macros |
| `/status` | GET | Get current bars/streak/victories |
| `/victory-check` | POST | Check and award victory |
| `/buy-reducer` | POST | Purchase reducer upgrade |

### Example MCP Usage
```json
// Agent logs a meal
{"command": "log", "args": {"protein": 30, "carbs": 50, "fat": 15, "calories": 450}}

// Agent checks progress
{"command": "status"}

// Agent sees all bars full, triggers victory
{"command": "victory-check"}
```

## Simulation Harness

### Purpose
Validate gamification mechanics without production data

### Design
- Supervisor generates N days of simulated meal data
- Each day: 3 meals with random macros (70-110% of goals)
- Runs through full loop: log → victory-check → buy-reducer
- Validates: victories parabolic, streaks compound correctly

### Output
```
Sim: 30 days
Victories: 42 (expected: 35-50)
Max Streak: 12
Reducer Lvl: 4
Final Goals: P130/C180/F48/Cal2000
PASS: Parabolic progression confirmed
```

## Integration with Existing Code

### Files to Modify

| File | Changes |
|------|---------|
| `src/db.ts` | Add `daily_bars` + `lifetime_stats` tables, migration logic |
| `src/cli.ts` | Add new commands: log, status, victory-check, buy-reducer, reset-day, sim |
| `src/mcp.ts` | Add new endpoints for gamification commands |

### Files to Create

| File | Purpose |
|------|---------|
| `src/engine.ts` | Gamification logic (bar updates, victory checks, reducer purchases) |
| `src/sim.ts` | Simulation harness |

### Backward Compatibility
- Existing `log` command renamed to `log-meal` (USDA search)
- New `log` command for quick macro entry
- Existing goals system (`nomnom goals`) remains for manual goal setting
- Gamification uses its own internal goals (can sync or stay separate)

## Open Questions

1. **Goal sync**: Should `nomnom goals` update the gamification goals, or keep them separate?
   - Recommendation: Keep separate for now, add sync later if needed

2. **Retroactive victories**: Should we award victories for past days when reducer is bought?
   - Recommendation: No, only moving forward

3. **Max reducer level**: Should there be a cap?
   - Recommendation: No cap, let it scale infinitely (true idle game feel)

## Success Metrics

- [ ] CLI loop feels satisfying (log → bars fill → victory → buy)
- [ ] Simulation validates parabolic progression
- [ ] MCP endpoints work for AI agents
- [ ] <200 LOC added
- [ ] All existing tests pass
