import lancedb from "@lancedb/lancedb";

async function debug() {
  const db = await lancedb.connect("./data/lance-debug2");

  // Create a simple table
  console.log("1. Creating table...");
  const table = await db.createTable("test", [
    { id: "1", name: "Alice", age: 30 },
    { id: "2", name: "Bob", age: 25 },
  ]);
  console.log("2. Table created");

  // Query all
  const all = await table.query().toArray();
  console.log("3. All rows:", all);

  // Query with where
  const filtered = await table.query().where(`id = '1'`).toArray();
  console.log("4. Filtered (id = '1'):", filtered);

  // Try different where syntax
  const filtered2 = await table.query().where("id = '1'").toArray();
  console.log("5. Filtered (id = '1', no backticks):", filtered2);

  // Delete
  console.log("6. Deleting id = '1'...");
  await table.delete(`id = '1'`);
  console.log("7. Delete done");

  const afterDelete = await table.query().toArray();
  console.log("8. After delete:", afterDelete);
}

debug().catch(console.error);
