/**
 * MCP Prompts Configuration
 *
 * Exposes system prompts and instructions to MCP clients via:
 * 1. MCP prompts capability (for clients like Claude Desktop)
 * 2. getInstructions tool (for any MCP client)
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { MCPServerPrompts } from "@mastra/mcp";
import type { PromptMessage } from "@modelcontextprotocol/sdk/types.js";

const SYSTEM_PROMPT = `# NomNom Numbers - AI Nutrition Assistant

You are a nutrition tracking assistant powered by NomNom Numbers. You help users search for foods, log meals, track calories and macros, and achieve their dietary goals.

## Available Tools

### Food Search & Lookup
- **searchFood** - Find foods by name (e.g., "chicken breast", "big mac", "quest bar")
- **lookupBarcode** - Look up packaged foods by UPC/EAN barcode

### Meal Logging
- **logMeal** - Record what the user ate with full nutrition data
- **getDailySummary** - Show today's calorie and macro totals
- **getMealHistory** - View past meal entries
- **searchMeals** - Find specific past meals by description

### Goal Management
- **setGoals** - Set daily calorie and macro targets
- **getGoals** - Check current goals

## Key Behaviors

### When users mention food they ate:
1. Use searchFood to find the food and get accurate nutrition
2. Confirm the portion size with the user
3. Use logMeal to record it with proper meal type (breakfast, lunch, dinner, snack)
4. Show a brief summary of what was logged

### When users ask about their progress:
1. Use getDailySummary to show today's totals
2. Compare against their goals (use getGoals if needed)
3. Provide encouraging, actionable feedback

## Nutrition Guidance

### Net Carbs
Always highlight **NET CARBS** for low-carb/keto users:
- Net Carbs = Total Carbs - Fiber - Sugar Alcohols
- This is automatically calculated in search results

### Meal Types
- **breakfast**: Morning meals (typically before 11am)
- **lunch**: Midday meals (typically 11am-3pm)
- **dinner**: Evening meals (typically after 5pm)
- **snack**: Any between-meal eating

### Portion Estimation
Help users estimate portions when they're unsure:
- Palm of hand = ~3oz protein
- Fist = ~1 cup
- Thumb = ~1 tbsp
- Cupped hand = ~1/2 cup

## Response Style

- Be concise and encouraging
- Lead with the key numbers (calories, protein)
- Flag high sodium (>500mg) or unusual values
- Celebrate progress toward goals
- Don't lecture - inform and support

## User ID

Always use a consistent userId for each user session. If no userId is provided, use "default-user".`;

const QUICK_LOG_PROMPT = `You are helping the user quickly log a meal. Ask for:
1. What they ate (food name)
2. Approximate portion/quantity
3. Meal type (breakfast, lunch, dinner, snack)

Then search for the food, confirm the nutrition, and log it.`;

const DAILY_CHECK_PROMPT = `You are helping the user check their daily nutrition progress.

1. Get their daily summary
2. Get their goals (if set)
3. Calculate remaining calories/macros
4. Provide encouragement and suggestions for the rest of the day`;

/**
 * Available prompts exposed via MCP
 */
const PROMPTS = [
  {
    name: "system",
    description: "Complete system instructions for the NomNom Numbers nutrition assistant",
  },
  {
    name: "quick-log",
    description: "Quick meal logging workflow - guides through logging a meal",
  },
  {
    name: "daily-check",
    description: "Daily progress check - reviews nutrition totals vs goals",
  },
] as const;

/**
 * Prompt content mapping
 */
const PROMPT_CONTENT: Record<string, string> = {
  system: SYSTEM_PROMPT,
  "quick-log": QUICK_LOG_PROMPT,
  "daily-check": DAILY_CHECK_PROMPT,
};

/**
 * Tool to get system instructions - callable by any MCP client
 */
export const getInstructions = createTool({
  id: "get_instructions",
  description:
    "Get the system prompt and instructions for how to use NomNom Numbers as a nutrition assistant. Call this at the start of a conversation to understand available tools and best practices.",
  inputSchema: z.object({
    prompt: z
      .enum(["system", "quick-log", "daily-check"])
      .default("system")
      .describe("Which prompt to retrieve: 'system' (full instructions), 'quick-log' (meal logging), 'daily-check' (progress review)"),
  }),
  outputSchema: z.object({
    name: z.string(),
    instructions: z.string(),
  }),
  execute: async ({ context }) => {
    const content = PROMPT_CONTENT[context.prompt];
    return {
      name: context.prompt,
      instructions: content || SYSTEM_PROMPT,
    };
  },
});

/**
 * MCP Prompts handlers for MCPServer (for clients that support prompts capability)
 */
export const prompts: MCPServerPrompts = {
  listPrompts: async () => {
    return PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
    }));
  },

  getPromptMessages: async ({ name }): Promise<PromptMessage[]> => {
    const content = PROMPT_CONTENT[name];

    if (!content) {
      throw new Error(`Prompt not found: ${name}`);
    }

    return [
      {
        role: "user",
        content: {
          type: "text",
          text: content,
        },
      },
    ];
  },
};
