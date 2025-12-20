import { describe, test, expect } from "bun:test";
import {
  sqliteSearchFoods,
  sqliteGetFoodDetails,
  sqliteLookupBarcode,
  sqliteFindSimilarFoods,
  sqliteGetStats,
} from "../../src/mastra/tools/sqlite-tools";

// Stable sample from USDA branded foods table
const SAMPLE_BARCODE = "00000000924665";
const SAMPLE_FDC_ID = 2689143;
const SAMPLE_QUERY = "kettle corn";

describe("USDA SQLite tools", () => {
  test("reports database stats", async () => {
    const stats = await sqliteGetStats.execute({ context: {} });
    expect(stats.total_foods).toBeGreaterThan(100_000);
    expect(stats.branded_foods).toBeGreaterThan(10_000);
    expect(stats.foods_with_barcodes).toBeGreaterThan(1_000);
  });

  test("search, details, barcode lookup, and similarity all work together", async () => {
    // Text search should surface the sample branded food somewhere in the results
    const search = await sqliteSearchFoods.execute({ context: { query: SAMPLE_QUERY, limit: 40 } });
    expect(search.foods.length).toBeGreaterThan(0);

    // Get full details for a known FDC ID
    const details = await sqliteGetFoodDetails.execute({ context: { fdc_id: SAMPLE_FDC_ID } });
    expect(details.found).toBe(true);
    expect(details.food?.barcode).toBe(SAMPLE_BARCODE);
    expect(details.food?.description.toLowerCase()).toContain("kettle corn");

    // Verify lookup by barcode round-trips to the same FDC ID
    const lookup = await sqliteLookupBarcode.execute({ context: { barcode: SAMPLE_BARCODE } });
    expect(lookup.found).toBe(true);
    expect(lookup.fdc_id).toBe(SAMPLE_FDC_ID);

    // Similar foods should return at least one alternative
    const similar = await sqliteFindSimilarFoods.execute({
      context: { fdc_id: SAMPLE_FDC_ID, limit: 5 },
    });
    expect(similar.similar_foods.length).toBeGreaterThan(0);
    expect(similar.similar_foods.length).toBeLessThanOrEqual(5);
  });
});
