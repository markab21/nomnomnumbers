import { setDbPath, resetDb, getUserGoalsTable, setUserGoals, getUserGoals } from "../src/db";

async function debug() {
  const TEST_DB_PATH = "./data/lance-debug";
  setDbPath(TEST_DB_PATH);

  console.log("1. Setting user goals...");
  const goals = {
    user_id: "test-user-123",
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 70,
    fiber: 30,
    sodium: 2300,
    sugar: 50,
    updated_at: new Date().toISOString(),
  };

  await setUserGoals(goals);
  console.log("2. Goals set successfully");

  // Try to query the table directly
  const table = await getUserGoalsTable();
  console.log("3. Got table");

  const allRows = await table.query().toArray();
  console.log("4. All rows in table:", allRows);

  // Try with the function
  const retrieved = await getUserGoals("test-user-123");
  console.log("5. Retrieved via getUserGoals:", retrieved);

  // Try manual query
  const manualResults = await table
    .query()
    .where(`user_id = 'test-user-123'`)
    .toArray();
  console.log("6. Manual query results:", manualResults);
}

debug().catch(console.error);
