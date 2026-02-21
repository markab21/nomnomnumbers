# Tolerance Band Design

Add a tolerance percentage to each goal that creates a grace zone on the wrong side of the target. This turns binary pass/fail goal tracking into a zone-based system: met, near, or missed.

## Concept

Tolerance is a percentage (0-100) stored per goal. It defines a forgiveness buffer beyond the target in the direction you don't want to go. Being on the correct side of the target always counts as "met".

Example: calories 2000, direction under, tolerance 10%
- 0-2000: met (on the correct side)
- 2001-2200: near (within the 10% grace zone)
- 2201+: over (missed)

Example: protein 120, direction over, tolerance 15%
- 120+: met (on the correct side)
- 102-119: near (within the 15% grace zone; 120 * 0.85 = 102)
- 0-101: under (missed)

## Schema

Add a column to the existing goals table:

```sql
ALTER TABLE goals ADD COLUMN tolerance REAL NOT NULL DEFAULT 0;
```

For new databases, the CREATE TABLE in initTables gets the column directly. For existing databases, a migration adds it.

Default tolerance is 0 (no grace zone), which preserves current binary behavior exactly.

## CLI

One new flag per macro:

```bash
bun start goals --calories 2000 --calories-tolerance 10 --protein 120 --protein-tolerance 15
```

Tolerance can be set independently of the target (update tolerance without changing target).

## Zone Logic

| Direction | Zone | Condition |
|-----------|------|-----------|
| under | met | actual <= target |
| under | near | actual > target AND actual <= target * (1 + tolerance/100) |
| under | over | actual > target * (1 + tolerance/100) |
| over | met | actual >= target |
| over | near | actual < target AND actual >= target * (1 - tolerance/100) |
| over | under | actual < target * (1 - tolerance/100) |

When tolerance is 0, "near" is impossible — zone is always "met" or "over"/"under".

## Streak Behavior

Both "met" and "near" sustain a streak. Only "over" or "under" (outside the band) breaks it.

This is the key behavioral change: streaks become more forgiving when tolerance > 0. A day where you slightly miss your target but stay within the grace zone doesn't reset your streak.

## Progress Output Changes

Each macro in the `today` section gains three new fields:

```json
"calories": {
  "actual": 2100,
  "goal": 2000,
  "remaining": -100,
  "percent": 105,
  "tolerance": 10,
  "band": 2200,
  "zone": "near"
}
```

- `tolerance`: the stored percentage (0 if not set)
- `band`: the computed threshold value (edge of the grace zone)
- `zone`: "met", "near", or "over"/"under"

## Goals Output Changes

The goals view includes tolerance when set:

```json
{
  "goals": {
    "calories": { "target": 2000, "direction": "under", "tolerance": 10 },
    "protein": { "target": 120, "direction": "over", "tolerance": 15 },
    "updatedAt": "2026-02-21 12:00:00"
  }
}
```

## Backward Compatibility

- Tolerance defaults to 0 for all existing goals
- With tolerance 0, zone is always "met" or "over"/"under" (no "near")
- With tolerance 0, streak behavior is identical to current binary logic
- The new fields (tolerance, band, zone) are always present in progress output — agents can ignore them if they don't care about zones

## What Does Not Change

- Weekly averages (raw numbers, no zone interpretation)
- Streak JSON shape (still current/best counts per goal + allGoals)
- The goals command set/reset behavior
- The progress command flags (--date)
