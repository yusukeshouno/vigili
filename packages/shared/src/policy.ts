import { z } from "zod";

/**
 * policy.yaml の構造（SPEC.md §3.3 準拠）。
 *
 * 評価順序:
 *   1. ハードコード invariants (daemon 側で固定)
 *   2. rules を上から順に評価、最初にマッチしたものを採用
 *   3. どれにもマッチしなければ defaults.unknown
 */

export const PolicyActionSchema = z.enum(["allow", "deny", "ask"]);
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export const NotifyLevelSchema = z.enum(["normal", "critical"]);
export type NotifyLevel = z.infer<typeof NotifyLevelSchema>;

/** "HH:MM" 形式の時刻文字列。 */
const HhMmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, "HH:MM 形式で指定してください");

export const RuleWhenSchema = z
  .object({
    tool: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    command_matches: z.string().optional(),
    path_matches: z.string().optional(),
    url_matches: z.string().optional(),
    repo_in: z.array(z.string().min(1)).min(1).optional(),
    time_between: z.tuple([HhMmSchema, HhMmSchema]).optional(),
  })
  .refine(
    (when) =>
      when.tool !== undefined ||
      when.command_matches !== undefined ||
      when.path_matches !== undefined ||
      when.url_matches !== undefined ||
      when.repo_in !== undefined ||
      when.time_between !== undefined,
    { message: "when は少なくとも 1 つの条件を含む必要があります" },
  );

export type RuleWhen = z.infer<typeof RuleWhenSchema>;

export const PolicyRuleSchema = z
  .object({
    name: z.string().min(1),
    when: RuleWhenSchema,
    action: PolicyActionSchema,
    reason: z.string().optional(),
    notify: NotifyLevelSchema.optional(),
  })
  .refine((rule) => rule.notify === undefined || rule.action === "ask", {
    message: "notify は action: ask のときのみ指定できます",
    path: ["notify"],
  });

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyDefaultsSchema = z.object({
  unknown: PolicyActionSchema,
  timeout_seconds: z.number().int().positive().default(300),
});

export type PolicyDefaults = z.infer<typeof PolicyDefaultsSchema>;

export const PolicyConfigSchema = z.object({
  defaults: PolicyDefaultsSchema,
  rules: z.array(PolicyRuleSchema).default([]),
});

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
