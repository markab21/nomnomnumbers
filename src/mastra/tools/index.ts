// Food tools
export { searchFood, lookupBarcode } from "./food-tools";

// SQLite tools (low-level for agent use)
export {
  sqliteSearchFoods,
  sqliteGetFoodDetails,
  sqliteLookupBarcode,
  sqliteFindSimilarFoods,
  sqliteGetStats,
} from "./sqlite-tools";

// Meal tools
export {
  logMeal,
  getDailySummary,
  getMealHistoryTool,
  searchMeals,
} from "./meal-tools";

// Goal tools
export { setGoals, getGoals } from "./goal-tools";

// Audit tools
export { logInteraction, searchAuditLog } from "./audit-tools";
