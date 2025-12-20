import { beforeAll, afterAll } from "bun:test";
import { rm } from "node:fs/promises";

// Test database path - separate from production
export const TEST_DB_PATH = "./data/lance-test";

// Clean up test database before and after all tests
beforeAll(async () => {
  try {
    await rm(TEST_DB_PATH, { recursive: true, force: true });
  } catch {
    // Directory may not exist, that's fine
  }
});

afterAll(async () => {
  try {
    await rm(TEST_DB_PATH, { recursive: true, force: true });
  } catch {
    // Cleanup failed, not critical
  }
});
