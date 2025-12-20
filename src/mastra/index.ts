import { Mastra } from "@mastra/core";
import { nutritionAgent } from "./agents";

export const mastra = new Mastra({
  agents: { nutritionAgent },
});

export { nutritionAgent } from "./agents";
export * from "./tools";
