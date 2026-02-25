# PR #2 Bugfixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 4 code review issues and update AGENTS.md CLI examples before merge.

**Architecture:** Targeted fixes to `src/cli.ts` and `src/db.ts` — add `parseNonNegativeInt` for offset, remove `Math.max(0,...)` clamping on remaining, add `daysWithData` to trend averages, sync `plugin.json` version. Update `AGENTS.md` to use `nomnom` CLI instead of `bun start`.

**Tech Stack:** TypeScript, Bun, SQLite

---

### Task 1: Add `parseNonNegativeInt` and use it for `--offset`

**Files:**
- Modify: `src/cli.ts:98-103` (add new function after `parsePositiveInt`)
- Modify: `src/cli.ts:679` (switch history offset to new function)

**Step 1: Add `parseNonNegativeInt` function after `parsePositiveInt`**

In `src/cli.ts`, after line 103 (end of `parsePositiveInt`), add:

```typescript
function parseNonNegativeInt(value: string | undefined, defaultValue: number, max: number = 10000): number {
  if (value === undefined) return defaultValue;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0) return defaultValue;
  return Math.min(n, max);
}
```

**Step 2: Update history command to use `parseNonNegativeInt`**

In `src/cli.ts` line 679, change:

```typescript
// Before:
const offset = parsePositiveInt(flags.offset, 0, 10000);

// After:
const offset = parseNonNegativeInt(flags.offset, 0);
```

**Step 3: Verify manually**

Run: `bun start history --offset 0 --limit 2 --json`
Expected: Returns first 2 meals with `"offset": 0`

Run: `bun start history --offset 5 --limit 2 --json`
Expected: Returns 2 meals starting from position 5

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "fix: add parseNonNegativeInt for --offset (accepts 0)"
```

---

### Task 2: Remove `Math.max(0,...)` clamping on remaining — preserve signed values

**Files:**
- Modify: `src/cli.ts:643-644` (remaining calculation in today case)

**Step 1: Fix the remaining calculation**

In `src/cli.ts` line 643-644, change:

```typescript
// Before:
const actual = totals[g.key as keyof typeof totals] as number;
remainingObj[g.key] = Math.max(0, Math.round((g.target - actual) * 10) / 10);

// After:
const actual = (totals as Record<string, number>)[g.key] ?? 0;
remainingObj[g.key] = Math.round((g.target - actual) * 10) / 10;
```

This does two things:
1. Removes the unsafe double `as` cast — uses `?? 0` for safety instead
2. Removes `Math.max(0,...)` so negative values (overage) are preserved, matching the `progress` command behavior

**Step 2: Verify manually**

Run: `bun start goals --set calories=2000 --json` (set a goal)
Run: `bun start today --json`
Expected: `remaining.calories` can be negative if over goal

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "fix: preserve signed remaining values in today output"
```

---

### Task 3: Add `daysWithData` to `TrendData` averages

**Files:**
- Modify: `src/db.ts:959-971` (TrendData interface)
- Modify: `src/db.ts:1012-1022` (getTrendData return value)

**Step 1: Update TrendData interface**

In `src/db.ts` line 962, change the averages type:

```typescript
// Before:
averages: { calories: number; protein: number; carbs: number; fat: number };

// After:
averages: { calories: number; protein: number; carbs: number; fat: number; daysWithData: number };
```

**Step 2: Add `daysWithData` to the averages object**

In `src/db.ts` lines 1013-1020, add `daysWithData` to both branches:

```typescript
// Before:
const daysWithData = daily.length;
const averages = daysWithData > 0
  ? {
      calories: Math.round(daily.reduce((s, d) => s + d.calories, 0) / daysWithData * 10) / 10,
      protein: Math.round(daily.reduce((s, d) => s + d.protein, 0) / daysWithData * 10) / 10,
      carbs: Math.round(daily.reduce((s, d) => s + d.carbs, 0) / daysWithData * 10) / 10,
      fat: Math.round(daily.reduce((s, d) => s + d.fat, 0) / daysWithData * 10) / 10,
    }
  : { calories: 0, protein: 0, carbs: 0, fat: 0 };

// After:
const daysWithData = daily.length;
const averages = daysWithData > 0
  ? {
      calories: Math.round(daily.reduce((s, d) => s + d.calories, 0) / daysWithData * 10) / 10,
      protein: Math.round(daily.reduce((s, d) => s + d.protein, 0) / daysWithData * 10) / 10,
      carbs: Math.round(daily.reduce((s, d) => s + d.carbs, 0) / daysWithData * 10) / 10,
      fat: Math.round(daily.reduce((s, d) => s + d.fat, 0) / daysWithData * 10) / 10,
      daysWithData,
    }
  : { calories: 0, protein: 0, carbs: 0, fat: 0, daysWithData: 0 };
```

**Step 3: Verify manually**

Run: `bun start trends --days 7 --json`
Expected: `averages.daysWithData` is present and shows the actual number of days used as divisor

**Step 4: Commit**

```bash
git add src/db.ts
git commit -m "fix: include daysWithData in trend averages for unambiguous JSON"
```

---

### Task 4: Sync `plugin.json` version to 2.3.0

**Files:**
- Modify: `plugin.json:2`

**Step 1: Update version**

```json
// Before:
"version": "2.2.0"

// After:
"version": "2.3.0"
```

**Step 2: Commit**

```bash
git add plugin.json
git commit -m "fix: sync plugin.json version to 2.3.0"
```

---

### Task 5: Update AGENTS.md to use `nomnom` CLI instead of `bun start`

**Files:**
- Modify: `AGENTS.md`

**Step 1: Replace `bun start` with `nomnom` in CLI examples**

The package installs a `nomnom` binary (`package.json` "bin" field). AGENTS.md currently shows `bun start` which is the dev workflow, not the installed CLI. Replace all `bun start` references in the CLI Commands section and USDA section with `nomnom`.

Key changes:
- `bun start help` → `nomnom help`
- `bun start search "chicken breast"` → `nomnom search "chicken breast"`
- `bun start init --download-usda` → `nomnom init --download-usda`
- etc.

Keep `bun run` references in the Build & Development section (typecheck, smoke tests, dev) since those are dev-only scripts.

Also update the note: `bun start -h` → `nomnom -h`

**Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md CLI examples from bun start to nomnom"
```

---

### Task 6: Run smoke tests to verify nothing is broken

**Step 1: Run existing smoke tests**

```bash
bun run smoke:goals
bun run smoke:crud
```

Expected: All checks pass

**Step 2: Quick manual sanity check**

```bash
bun start today --json
bun start history --offset 0 --limit 3 --json
bun start trends --days 7 --json
```

Expected: All return valid JSON without errors
