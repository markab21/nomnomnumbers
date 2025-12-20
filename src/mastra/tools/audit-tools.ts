import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { addAuditLog, searchAuditLogs } from "../../db";
import { auditRoleSchema } from "../../db/schemas";

export const logInteraction = createTool({
  id: "log_interaction",
  description:
    "Log an interaction to the audit trail. Used internally to track all conversations and tool calls.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    sessionId: z.string().describe("The session/conversation ID"),
    role: auditRoleSchema.describe("Role of the message: user, assistant, or tool"),
    content: z.string().describe("The message or action content"),
    toolName: z.string().optional().describe("Name of the tool if this is a tool call"),
    toolInput: z.string().optional().describe("JSON string of tool input parameters"),
    toolOutput: z.string().optional().describe("JSON string of tool output"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    logId: z.string(),
  }),
  execute: async ({ context }) => {
    const logId = crypto.randomUUID();
    const now = new Date().toISOString();

    await addAuditLog({
      id: logId,
      user_id: context.userId,
      session_id: context.sessionId,
      role: context.role,
      content: context.content,
      tool_name: context.toolName ?? null,
      tool_input: context.toolInput ?? null,
      tool_output: context.toolOutput ?? null,
      timestamp: now,
    });

    return {
      success: true,
      logId,
    };
  },
});

export const searchAuditLog = createTool({
  id: "search_audit_log",
  description:
    "Search through conversation history and tool interactions using semantic search. Useful for finding past conversations about specific topics.",
  inputSchema: z.object({
    userId: z.string().describe("The user ID"),
    query: z.string().describe("Search query to find relevant interactions"),
    limit: z.number().int().positive().max(100).default(20).describe("Maximum number of results"),
  }),
  outputSchema: z.object({
    interactions: z.array(
      z.object({
        id: z.string(),
        sessionId: z.string(),
        role: z.string(),
        content: z.string(),
        toolName: z.string().nullable(),
        timestamp: z.string(),
      })
    ),
    count: z.number(),
  }),
  execute: async ({ context }) => {
    const logs = await searchAuditLogs(context.userId, context.query, context.limit);

    return {
      interactions: logs.map((log) => ({
        id: log.id,
        sessionId: log.session_id,
        role: log.role,
        content: log.content,
        toolName: log.tool_name,
        timestamp: log.timestamp,
      })),
      count: logs.length,
    };
  },
});
