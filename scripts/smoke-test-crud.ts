#!/usr/bin/env bun
/**
 * smoke-test-crud.ts
 * Tests delete, edit, and custom foods end-to-end.
 * Run: bun scripts/smoke-test-crud.ts
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const dataDir = process.env.NOMNOM_DATA_DIR ?? join(homedir(), ".local", "share", "nomnom");
const dbPath = join(dataDir, "nomnom.db");
const projectRoot = new URL("..", import.meta.url).pathname;

// Clean DB
if (existsSync(dbPath)) rmSync(dbPath);
if (existsSync(dbPath + "-wal")) rmSync(dbPath + "-wal");
if (existsSync(dbPath + "-shm")) rmSync(dbPath + "-shm");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    const msg = detail ? `${name}: ${detail}` : name;
    failures.push(msg);
    console.log(`✗ ${msg}`);
  }
}

function run(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", "start", ...args], { cwd: projectRoot, stderr: "pipe" });
  return {
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
    exitCode: result.exitCode ?? 1,
  };
}

function resetDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

// ============================================================
// Section 1: Custom Foods — foods add
// ============================================================
console.log("\n--- Section 1: Custom Foods — foods add ---");
resetDb();

const addHuel = run("foods", "add", "Huel Black", "--brand", "Huel", "--calories", "400", "--protein", "40", "--carbs", "37", "--fat", "13", "--serving", "1 bottle");
check("S1: foods add Huel exits 0", addHuel.exitCode === 0, `exit=${addHuel.exitCode}`);
const huelJson = JSON.parse(addHuel.stdout);
check("S1: foods add Huel success", huelJson.success === true);
check("S1: foods add Huel has id", typeof huelJson.id === "string" && huelJson.id.length > 0, `id=${huelJson.id}`);
check("S1: foods add Huel name", huelJson.name === "Huel Black", `name=${huelJson.name}`);
const huelId = huelJson.id;

const addBar = run("foods", "add", "Test Bar", "--barcode", "1234567890", "--calories", "200", "--protein", "20", "--carbs", "22", "--fat", "8");
check("S1: foods add Test Bar exits 0", addBar.exitCode === 0, `exit=${addBar.exitCode}`);
const barJson = JSON.parse(addBar.stdout);
check("S1: foods add Test Bar success", barJson.success === true);
check("S1: foods add Test Bar has id", typeof barJson.id === "string" && barJson.id.length > 0, `id=${barJson.id}`);
const barId = barJson.id;

// ============================================================
// Section 2: Custom Foods — foods list
// ============================================================
console.log("\n--- Section 2: Custom Foods — foods list ---");

const listResult = run("foods", "list");
check("S2: foods list exits 0", listResult.exitCode === 0, `exit=${listResult.exitCode}`);
const listJson = JSON.parse(listResult.stdout);
check("S2: foods list count = 2", listJson.count === 2, `count=${listJson.count}`);
const foodNames = listJson.foods.map((f: { name: string }) => f.name);
check("S2: Huel Black in list", foodNames.includes("Huel Black"), `names=${foodNames}`);
check("S2: Test Bar in list", foodNames.includes("Test Bar"), `names=${foodNames}`);

// ============================================================
// Section 3: Custom Foods — search integration
// ============================================================
console.log("\n--- Section 3: Custom Foods — search integration ---");

const searchHuel = run("search", "huel");
check("S3: search huel exits 0", searchHuel.exitCode === 0, `exit=${searchHuel.exitCode}`);
const searchJson = JSON.parse(searchHuel.stdout);
check("S3: search has results", searchJson.count > 0, `count=${searchJson.count}`);
const customResult = searchJson.results.find((r: { source: string }) => r.source === "custom");
check("S3: has custom source result", customResult !== undefined);
check("S3: custom result has id (not fdcId)", typeof customResult?.id === "string", `id=${customResult?.id}`);
check("S3: custom result description matches", customResult?.description === "Huel Black", `desc=${customResult?.description}`);

// ============================================================
// Section 4: Custom Foods — barcode lookup integration
// ============================================================
console.log("\n--- Section 4: Custom Foods — barcode lookup ---");

const lookupBar = run("lookup", "1234567890");
check("S4: lookup exits 0", lookupBar.exitCode === 0, `exit=${lookupBar.exitCode}`);
const lookupJson = JSON.parse(lookupBar.stdout);
check("S4: lookup found = true", lookupJson.found === true, `found=${lookupJson.found}`);
check("S4: lookup source = custom", lookupJson.source === "custom", `source=${lookupJson.source}`);
check("S4: lookup description = Test Bar", lookupJson.description === "Test Bar", `desc=${lookupJson.description}`);

// ============================================================
// Section 5: Custom Foods — foods delete
// ============================================================
console.log("\n--- Section 5: Custom Foods — foods delete ---");

const deleteBar = run("foods", "delete", barId);
check("S5: foods delete exits 0", deleteBar.exitCode === 0, `exit=${deleteBar.exitCode}`);
const deleteBarJson = JSON.parse(deleteBar.stdout);
check("S5: foods delete success", deleteBarJson.success === true);

const listAfterDelete = run("foods", "list");
const listAfterJson = JSON.parse(listAfterDelete.stdout);
check("S5: foods list count = 1 after delete", listAfterJson.count === 1, `count=${listAfterJson.count}`);
check("S5: only Huel remains", listAfterJson.foods[0]?.name === "Huel Black", `name=${listAfterJson.foods[0]?.name}`);

// ============================================================
// Section 6: Log + Delete meal
// ============================================================
console.log("\n--- Section 6: Log + Delete meal ---");
resetDb();

const logMeal = run("log", "Test Meal", "--calories", "300", "--protein", "25");
check("S6: log exits 0", logMeal.exitCode === 0, `exit=${logMeal.exitCode}`);
const logJson = JSON.parse(logMeal.stdout);
check("S6: log success", logJson.success === true);
const mealId = logJson.id;

const todayBefore = run("today");
const todayBeforeJson = JSON.parse(todayBefore.stdout);
check("S6: today shows meal (count=1)", todayBeforeJson.totals.mealCount === 1, `count=${todayBeforeJson.totals.mealCount}`);

const deleteMeal = run("delete", mealId);
check("S6: delete exits 0", deleteMeal.exitCode === 0, `exit=${deleteMeal.exitCode}`);
const deleteMealJson = JSON.parse(deleteMeal.stdout);
check("S6: delete success", deleteMealJson.success === true);
check("S6: delete foodName matches", deleteMealJson.foodName === "Test Meal", `foodName=${deleteMealJson.foodName}`);

const todayAfter = run("today");
const todayAfterJson = JSON.parse(todayAfter.stdout);
check("S6: today meal count drops to 0", todayAfterJson.totals.mealCount === 0, `count=${todayAfterJson.totals.mealCount}`);

// ============================================================
// Section 7: Log + Edit meal
// ============================================================
console.log("\n--- Section 7: Log + Edit meal ---");
resetDb();

const logEdit = run("log", "Edit Test", "--calories", "100", "--protein", "10", "--type", "breakfast");
check("S7: log exits 0", logEdit.exitCode === 0, `exit=${logEdit.exitCode}`);
const logEditJson = JSON.parse(logEdit.stdout);
const editId = logEditJson.id;

const editResult = run("edit", editId, "--calories", "200", "--fat", "15");
check("S7: edit exits 0", editResult.exitCode === 0, `exit=${editResult.exitCode}`);
const editJson = JSON.parse(editResult.stdout);
check("S7: edit success", editJson.success === true);
check("S7: edit updated contains calories", editJson.updated.includes("calories"), `updated=${editJson.updated}`);
check("S7: edit updated contains fat", editJson.updated.includes("fat"), `updated=${editJson.updated}`);

const editNoChange = run("edit", editId);
check("S7: edit no-change exits 0", editNoChange.exitCode === 0, `exit=${editNoChange.exitCode}`);
const editNoChangeJson = JSON.parse(editNoChange.stdout);
check("S7: edit no-change updated = []", editNoChangeJson.updated.length === 0, `updated=${editNoChangeJson.updated}`);

const todayEdited = run("today");
const todayEditedJson = JSON.parse(todayEdited.stdout);
const editedMeal = todayEditedJson.meals.find((m: { id: string }) => m.id === editId);
check("S7: edited meal exists in today", editedMeal !== undefined);
check("S7: edited calories = 200", editedMeal?.calories === 200, `calories=${editedMeal?.calories}`);
check("S7: edited fat = 15", editedMeal?.fat === 15, `fat=${editedMeal?.fat}`);
check("S7: edited protein unchanged = 10", editedMeal?.protein === 10, `protein=${editedMeal?.protein}`);

// ============================================================
// Section 8: Error cases
// ============================================================
console.log("\n--- Section 8: Error cases ---");

const deleteNonexistent = run("delete", "nonexistent-id");
check("S8: delete nonexistent exits 1", deleteNonexistent.exitCode === 1, `exit=${deleteNonexistent.exitCode}`);

const editNonexistent = run("edit", "nonexistent-id", "--calories", "100");
check("S8: edit nonexistent exits 1", editNonexistent.exitCode === 1, `exit=${editNonexistent.exitCode}`);

const foodsDeleteNonexistent = run("foods", "delete", "nonexistent-id");
check("S8: foods delete nonexistent exits 1", foodsDeleteNonexistent.exitCode === 1, `exit=${foodsDeleteNonexistent.exitCode}`);

const deleteNoId = run("delete");
check("S8: delete no id exits 1", deleteNoId.exitCode === 1, `exit=${deleteNoId.exitCode}`);

const editNoId = run("edit");
check("S8: edit no id exits 1", editNoId.exitCode === 1, `exit=${editNoId.exitCode}`);

const foodsAddNoName = run("foods", "add");
check("S8: foods add no name exits 1", foodsAddNoName.exitCode === 1, `exit=${foodsAddNoName.exitCode}`);

// ============================================================
// Summary
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
}
