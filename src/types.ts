// Food sources
export type FoodSource = "openfoodfacts" | "usda" | "custom";

// Meal types
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

// Audit log roles
export type AuditRole = "user" | "assistant" | "tool";

// Base food record (without vector for input)
export interface FoodInput {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: string;
  source: FoodSource;
}

// Food record with vector embedding
export interface FoodRecord extends FoodInput {
  vector: number[];
}

// Base meal log (without vector for input)
export interface MealLogInput {
  id: string;
  userId: string;
  foodId: string | null;
  foodName: string;
  quantity: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealType: MealType;
  loggedAt: string;
  notes: string | null;
}

// Meal log with vector embedding
export interface MealLogRecord extends MealLogInput {
  vector: number[];
}

// Base audit log (without vector for input)
export interface AuditLogInput {
  id: string;
  userId: string;
  sessionId: string;
  role: AuditRole;
  content: string;
  toolName: string | null;
  toolInput: string | null;
  toolOutput: string | null;
  timestamp: string;
}

// Audit log with vector embedding
export interface AuditLogRecord extends AuditLogInput {
  vector: number[];
}

// User goals
export interface UserGoals {
  userId: string;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  updatedAt: string;
}

// Daily summary result
export interface DailySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealCount: number;
  meals: MealLogInput[];
  goals: UserGoals | null;
}
