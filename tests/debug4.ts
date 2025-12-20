import lancedb from "@lancedb/lancedb";

async function debug() {
  const db = await lancedb.connect("./data/lance-debug4");

  // Create a table with snake_case field names
  console.log("1. Creating table with snake_case...");
  const table = await db.createTable("test", [
    { id: "1", user_id: "user-1", user_name: "Alice" },
    { id: "2", user_id: "user-2", user_name: "Bob" },
  ]);
  console.log("2. Table created");

  // Query all
  const all = await table.query().toArray();
  console.log("3. All rows:", all);

  // Query with where
  const filtered = await table.query().where(`user_id = 'user-1'`).toArray();
  console.log("4. Filtered (user_id = 'user-1'):", filtered);

  // Delete
  console.log("5. Deleting user_id = 'user-1'...");
  await table.delete(`user_id = 'user-1'`);
  console.log("6. Delete done");

  const afterDelete = await table.query().toArray();
  console.log("7. After delete:", afterDelete);
}

debug().catch(console.error);
