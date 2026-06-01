import {
  ApprovalRequestSchema,
  FinalDecisionSchema,
  PolicyRuleSchema,
  StatsBucketsSchema,
} from "@vigili/shared";
import { z } from "zod";

/**
 * Unix socket 上で daemon と sentinel-cli / Sentinel.app が交わす管理コマンド。
 * gate からは送らない。WebSocket とは別経路 (Bearer 認証なし、socket パーミッション 0600 で守る)。
 *
 * 弁別フィールド: kind === "admin"。これが無いメッセージは ToolRequest として扱う。
 */

export const AdminRequestSchema = z.discriminatedUnion("action", [
  z.object({
    kind: z.literal("admin"),
    action: z.literal("pending"),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("resolve"),
    id: z.string().uuid(),
    decision: FinalDecisionSchema,
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("reload"),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("stats"),
    /** UNIX ms。省略時は当日 00:00 (ローカル時刻ベース) */
    from_ms: z.number().int().nonnegative().optional(),
    /** UNIX ms。省略時は Date.now() + 60s (未来要素を含めず、丸めの取りこぼし防止に余裕) */
    to_ms: z.number().int().nonnegative().optional(),
  }),
  /** 現在ロード中のポリシールール一覧を返す。 */
  z.object({
    kind: z.literal("admin"),
    action: z.literal("rules"),
  }),
  /**
   * ポリシーが自動判定した直近の decisions を返す。
   * decided_by が "policy:<name>" の行を新しい順に返す。
   */
  z.object({
    kind: z.literal("admin"),
    action: z.literal("history"),
    limit: z.number().int().positive().max(200).optional(),
  }),
  /**
   * policy.generated.yaml から指定名のルールを削除して policy をリロードする。
   * main の policy.yaml は変更しない。
   */
  z.object({
    kind: z.literal("admin"),
    action: z.literal("rule-delete"),
    name: z.string().min(1),
  }),
  /**
   * オンボーディングウィザード用: 候補ルールのカタログを返す。
   * Mac アプリがチェックボックス UI として描画する。
   */
  z.object({
    kind: z.literal("admin"),
    action: z.literal("policy-catalog"),
  }),
  /**
   * オンボーディングウィザードの完了時に呼ばれる:
   * 選択された id 群からルールを組み立てて policy.yaml を上書きする。
   * 既存の policy.yaml は backup (policy.yaml.bak) に退避してから上書きする。
   */
  z.object({
    kind: z.literal("admin"),
    action: z.literal("policy-write-from-catalog"),
    selected_ids: z.array(z.string().min(1)),
  }),
  /**
   * Mac アプリの「Sign in with Apple」後に呼ばれる: relay の接続先を config.yaml に
   * 永続化し、daemon の relay client をプロセス再起動なしでホット再接続させる。
   * これで `launchctl kickstart` を経由せずにサインインだけで relay へ繋がる。
   */
  z.object({
    kind: z.literal("admin"),
    action: z.literal("relay-configure"),
    url: z.string().url(),
    pairing_id: z.string().min(1),
    agent_key: z.string().min(1),
    reconnect_max_seconds: z.number().int().positive().optional(),
  }),
]);

export type AdminRequest = z.infer<typeof AdminRequestSchema>;

/**
 * stats レスポンスは shared の `StatsBucketsSchema` をそのまま使う。
 * WS の `stats` メッセージと同じ正準スキーマを共有する (重複定義を避ける)。
 */
const StatsBucketsZ = StatsBucketsSchema;

/** 自動判定された decisions の 1 件。Mac app / CLI が受け取る。 */
const PolicyHistoryItemZ = z.object({
  id: z.string(),
  created_at: z.number().int(),
  resolved_at: z.number().int().nullable(),
  tool_name: z.string(),
  /** tool_input から抽出した代表的な文字列 (command / path / url 等)。 */
  tool_input_summary: z.string(),
  decision: z.enum(["allow", "deny"]),
  /** "policy:<ruleName>" の <ruleName> 部分。 */
  rule_name: z.string(),
});

export type PolicyHistoryItem = z.infer<typeof PolicyHistoryItemZ>;

export const AdminResponseSchema = z.discriminatedUnion("action", [
  z.object({
    kind: z.literal("admin"),
    action: z.literal("pending"),
    ok: z.literal(true),
    pending: z.array(ApprovalRequestSchema),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("resolve"),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("reload"),
    ok: z.boolean(),
    rules: z.number().int().optional(),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("stats"),
    ok: z.literal(true),
    stats: StatsBucketsZ,
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("rules"),
    ok: z.literal(true),
    rules: z.array(PolicyRuleSchema),
    /** policy.generated.yaml に存在するルール名のセット。 */
    generatedRuleNames: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("history"),
    ok: z.literal(true),
    items: z.array(PolicyHistoryItemZ),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("rule-delete"),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("policy-catalog"),
    ok: z.literal(true),
    items: z.array(
      z.object({
        id: z.string(),
        category: z.enum(["convenience", "danger"]),
        label: z.string(),
        description: z.string(),
      }),
    ),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("policy-write-from-catalog"),
    ok: z.boolean(),
    written: z.number().int().optional(),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("relay-configure"),
    ok: z.boolean(),
    /** 再接続を試みた直後の接続状態 (確立は非同期なので "試行直後の値")。 */
    connected: z.boolean().optional(),
    error: z.string().optional(),
  }),
]);

export type AdminResponse = z.infer<typeof AdminResponseSchema>;
