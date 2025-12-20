import lancedb from "@lancedb/lancedb";

async function debug() {
  const db = await lancedb.connect("./data/lance-debug3");

  // Create a table with camelCase field names
  console.log("1. Creating table with camelCase...");
  const table = await db.createTable("test", [
    { id: "1", userId: "user-1", userName: "Alice" },
    { id: "2", userId: "user-2", userName: "Bob" },
  ]);
  console.log("2. Table created");

  // Query all
  const all = await table.query().toArray();
  console.log("3. All rows:", all);

  // Query with where - unquoted
  try {
    const filtered = await table.query().where(`userId = 'user-1'`).toArray();
    console.log("4a. Filtered (userId unquoted):", filtered);
  } catch (e) {
    console.log("4a. Error with unquoted:", e);
  }

  // Query with where - quoted
  try {
    const filtered2 = await table.query().where(`"userId" = 'user-1'`).toArray();
    console.log("4b. Filtered (userId quoted):", filtered2);
  } catch (e) {
    console.log("4b. Error with quoted:", e);
  }

  // Delete - unquoted
  console.log("5. Deleting userId = 'user-1' (unquoted)...");
  try {
    await table.delete(`userId = 'user-1'`);
    console.log("5a. Delete done");
  } catch (e) {
    console.log("5a. Delete error:", e);
  }

  const afterDelete = await table.query().toArray();
  console.log("6. After delete:", afterDelete);
}

debug().catch(console.error);
