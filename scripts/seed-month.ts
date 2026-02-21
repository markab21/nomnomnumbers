#!/usr/bin/env bun
/**
 * seed-month.ts
 * Populates 28 days of meal history into the nomnom DB for smoke testing.
 * Run: bun scripts/seed-month.ts
 * Days covered: -27 (oldest) through 0 (today)
 */

import { getDb, initializeDatabase } from "../src/db";

// Initialize DB (creates tables if needed)
initializeDatabase();
const db = getDb();

interface MealTemplate {
  foodName: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  time: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  unit: string;
  qty: number;
}

// 7-day repeating template (Mon–Sun)
const WEEK_TEMPLATE: MealTemplate[][] = [
  // Day 0: Monday
  [
    { foodName: "Oatmeal", mealType: "breakfast", time: "07:30:00", calories: 350, protein: 12, carbs: 60, fat: 6, unit: "bowl", qty: 1 },
    { foodName: "Chicken Wrap", mealType: "lunch", time: "12:15:00", calories: 520, protein: 35, carbs: 48, fat: 14, unit: "wrap", qty: 1 },
    { foodName: "Salmon Rice", mealType: "dinner", time: "18:45:00", calories: 680, protein: 42, carbs: 72, fat: 18, unit: "serving", qty: 1 },
    { foodName: "Apple", mealType: "snack", time: "15:00:00", calories: 95, protein: 0, carbs: 25, fat: 0, unit: "medium", qty: 1 },
  ],
  // Day 1: Tuesday
  [
    { foodName: "Scrambled Eggs", mealType: "breakfast", time: "07:30:00", calories: 310, protein: 22, carbs: 4, fat: 22, unit: "serving", qty: 1 },
    { foodName: "Tuna Salad", mealType: "lunch", time: "12:15:00", calories: 420, protein: 38, carbs: 18, fat: 20, unit: "serving", qty: 1 },
    { foodName: "Beef Stir Fry", mealType: "dinner", time: "18:45:00", calories: 590, protein: 38, carbs: 55, fat: 20, unit: "serving", qty: 1 },
    { foodName: "Greek Yogurt", mealType: "snack", time: "15:00:00", calories: 150, protein: 15, carbs: 12, fat: 3, unit: "cup", qty: 1 },
  ],
  // Day 2: Wednesday
  [
    { foodName: "Banana Smoothie", mealType: "breakfast", time: "07:30:00", calories: 380, protein: 8, carbs: 72, fat: 6, unit: "glass", qty: 1 },
    { foodName: "Veggie Burrito", mealType: "lunch", time: "12:15:00", calories: 510, protein: 18, carbs: 68, fat: 16, unit: "burrito", qty: 1 },
    { foodName: "Grilled Chicken", mealType: "dinner", time: "18:45:00", calories: 620, protein: 52, carbs: 30, fat: 28, unit: "serving", qty: 1 },
    { foodName: "Almonds", mealType: "snack", time: "15:00:00", calories: 160, protein: 6, carbs: 6, fat: 14, unit: "handful", qty: 1 },
  ],
  // Day 3: Thursday
  [
    { foodName: "Avocado Toast", mealType: "breakfast", time: "07:30:00", calories: 420, protein: 12, carbs: 45, fat: 22, unit: "slice", qty: 2 },
    { foodName: "Turkey Sandwich", mealType: "lunch", time: "12:15:00", calories: 480, protein: 32, carbs: 52, fat: 12, unit: "sandwich", qty: 1 },
    { foodName: "Shrimp Pasta", mealType: "dinner", time: "18:45:00", calories: 640, protein: 36, carbs: 78, fat: 18, unit: "serving", qty: 1 },
    { foodName: "Orange", mealType: "snack", time: "15:00:00", calories: 60, protein: 1, carbs: 15, fat: 0, unit: "medium", qty: 1 },
  ],
  // Day 4: Friday
  [
    { foodName: "Pancakes", mealType: "breakfast", time: "07:30:00", calories: 450, protein: 10, carbs: 75, fat: 12, unit: "stack", qty: 1 },
    { foodName: "Caesar Salad", mealType: "lunch", time: "12:15:00", calories: 380, protein: 18, carbs: 22, fat: 24, unit: "serving", qty: 1 },
    { foodName: "Pork Tenderloin", mealType: "dinner", time: "18:45:00", calories: 580, protein: 48, carbs: 28, fat: 28, unit: "serving", qty: 1 },
    { foodName: "Cheese Crackers", mealType: "snack", time: "15:00:00", calories: 180, protein: 6, carbs: 20, fat: 9, unit: "serving", qty: 1 },
  ],
  // Day 5: Saturday
  [
    { foodName: "French Toast", mealType: "breakfast", time: "07:30:00", calories: 490, protein: 14, carbs: 68, fat: 16, unit: "serving", qty: 1 },
    { foodName: "Veggie Soup", mealType: "lunch", time: "12:15:00", calories: 320, protein: 10, carbs: 45, fat: 8, unit: "bowl", qty: 1 },
    { foodName: "Pizza", mealType: "dinner", time: "18:45:00", calories: 720, protein: 28, carbs: 85, fat: 26, unit: "slice", qty: 3 },
    { foodName: "Ice Cream", mealType: "snack", time: "15:00:00", calories: 250, protein: 4, carbs: 32, fat: 12, unit: "scoop", qty: 2 },
  ],
  // Day 6: Sunday
  [
    { foodName: "Waffles", mealType: "breakfast", time: "07:30:00", calories: 410, protein: 10, carbs: 62, fat: 14, unit: "waffle", qty: 2 },
    { foodName: "BLT Sandwich", mealType: "lunch", time: "12:15:00", calories: 440, protein: 22, carbs: 38, fat: 20, unit: "sandwich", qty: 1 },
    { foodName: "Lamb Chops", mealType: "dinner", time: "18:45:00", calories: 660, protein: 44, carbs: 18, fat: 36, unit: "serving", qty: 1 },
    { foodName: "Granola Bar", mealType: "snack", time: "15:00:00", calories: 200, protein: 5, carbs: 28, fat: 8, unit: "bar", qty: 1 },
  ],
];

// Week-level calorie variation factors (4 repetitions of the 7-day template)
const WEEK_FACTORS = [1.0, 0.97, 1.03, 0.95];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const stmt = db.prepare(`
  INSERT INTO meals (id, food_name, quantity, unit, meal_type, logged_at, notes, calories, protein, carbs, fat)
  VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
`);

let totalInserted = 0;

// Insert days -27 (oldest) through 0 (today)
for (let dayOffset = -27; dayOffset <= 0; dayOffset++) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  const dateStr = formatDate(date);

  // Map dayOffset to template index 0–6
  const templateDayIndex = ((27 + dayOffset) % 7 + 7) % 7;
  const dayMeals = WEEK_TEMPLATE[templateDayIndex]!;

  // Which of the 4 week repetitions?
  const weekIndex = Math.floor((27 + dayOffset) / 7);
  const factor = WEEK_FACTORS[weekIndex] ?? 1.0;

  for (const meal of dayMeals) {
    const loggedAt = `${dateStr} ${meal.time}`;
    stmt.run(
      crypto.randomUUID(),
      meal.foodName,
      meal.qty,
      meal.unit,
      meal.mealType,
      loggedAt,
      round1(meal.calories * factor),
      round1(meal.protein * factor),
      round1(meal.carbs * factor),
      round1(meal.fat * factor),
    );
    totalInserted++;
  }
}

console.log(`Seeded ${totalInserted} meals across 28 days.`);
