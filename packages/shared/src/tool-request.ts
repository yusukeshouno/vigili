import { z } from "zod";

/**
 * Claude Code の PreToolUse hook から gate へ、そして gate から daemon へ渡される要求。
 * tool_input の中身はツールごとに異なるため Record<string, unknown> として受ける。
 * Bash/Edit/Write/WebFetch の典型形状は extractor (daemon 側) で取り出す。
 */
export const ToolRequestSchema = z.object({
  tool_name: z.string().min(1),
  tool_input: z.record(z.unknown()),
  cwd: z.string().min(1),
  session_id: z.string().min(1),
  /** gate が --tag で受け取った値。省略時は cwd basename から推測。 */
  session_tag: z.string().optional(),
});

export type ToolRequest = z.infer<typeof ToolRequestSchema>;
