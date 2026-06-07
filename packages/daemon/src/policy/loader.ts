import { readFile } from "node:fs/promises";
import { type PolicyConfig, PolicyConfigSchema, type ToolRequest } from "@vigili/shared";
import { parse as parseYaml } from "yaml";
import { matchInvariant } from "./invariants.js";
import { loadGeneratedRules } from "./promote.js";

/** policy.yaml ロード時の例外。CLI が catch して人間向けに表示する。 */
export class PolicyLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "PolicyLoadError";
  }
}

/**
 * メインの policy.yaml と (存在すれば) policy.generated.yaml をロードしてマージする。
 *
 * 評価順序:
 *   1. main の specific ルール (= 何らかのフィルタを持つもの)
 *   2. generated ルール (= promote で追加されたもの)
 *   3. main の catch-all ルール (= when に tool しか書かれていないもの。例: "未分類の Bash")
 *   4. defaults.unknown
 *
 * generated を catch-all の前に入れるのは、promote が「カオスの中で芽吹いた allow」だから。
 * catch-all を後ろに残すことで、未知のパターンは引き続き ask に流せる。
 */
export async function loadPolicyFile(
  path: string,
  log?: (msg: string) => void,
): Promise<PolicyConfig> {
  const main = await loadOnePolicy(path);
  // policy.yaml の正規表現は厳格に検証する (手書きなので修正できる)
  validatePolicyRegexes(main);

  const generatedPath = path.replace(/\.yaml$/u, ".generated.yaml");
  let generatedRules: PolicyConfig["rules"] = [];
  try {
    generatedRules = await loadGeneratedRules(generatedPath);
  } catch (err) {
    throw new PolicyLoadError(`${generatedPath} のロード失敗: ${(err as Error).message}`, err);
  }

  // generated ルールは自動生成のため、不正な正規表現が混入しても daemon をクラッシュさせず
  // 該当ルールを warn + skip して degraded 動作を継続する。
  const generatedConfig: PolicyConfig = { defaults: main.defaults, rules: generatedRules };
  validatePolicyRegexes(generatedConfig, {
    warnOnly: true,
    onWarn: (msg) => log?.(`[vigili-policy] 警告: generated rule を skip — ${msg}`),
  });

  const specific = main.rules.filter((r) => !isCatchAll(r));
  const catchAll = main.rules.filter((r) => isCatchAll(r));

  const merged: PolicyConfig = {
    defaults: main.defaults,
    rules: [...specific, ...generatedConfig.rules, ...catchAll],
  };

  validatePolicyAgainstInvariants(merged);
  return merged;
}

/** when に tool しか指定がない rule は「catch-all」とみなす。 */
function isCatchAll(rule: PolicyConfig["rules"][number]): boolean {
  const w = rule.when;
  return (
    w.tool !== undefined &&
    w.command_matches === undefined &&
    w.path_matches === undefined &&
    w.url_matches === undefined &&
    w.repo_in === undefined &&
    w.time_between === undefined
  );
}

async function loadOnePolicy(path: string): Promise<PolicyConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new PolicyLoadError(`policy.yaml を読めません: ${path}`, err);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new PolicyLoadError(`policy.yaml の YAML パースに失敗: ${path}`, err);
  }

  const result = PolicyConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new PolicyLoadError(
      `policy.yaml のスキーマ違反: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/**
 * 「invariant が deny する操作を allow するルール」を検出して起動失敗にする。
 *
 * 仕組み: invariant がブロックする代表的なコマンドを合成し、各 allow ルールに通す。
 * いずれかにマッチしたら、そのルールが invariant を上書きしていると判定する。
 */
const INVARIANT_PROBE_COMMANDS: readonly string[] = [
  // rm -rf root (canonical + フラグ順序/分割/long-form の等価別表記)
  "rm -rf /",
  "rm -fr /",
  "rm -r -f /",
  "rm -f -r /",
  "rm --recursive --force /",
  "rm --force --recursive /",
  "rm -rf /usr/local",
  "rm -rf '/'",
  // rm -rf home
  "rm -rf ~/",
  "rm -fr ~/",
  "rm -rf ~/Documents",
  "rm --recursive --force $HOME",
  // git force push to protected branch (前置/後置/refspec/long-form)
  "git push --force origin main",
  "git push origin main --force",
  "git push -f origin master",
  "git push origin master -f",
  "git push --force-with-lease origin production",
  "git push origin +main",
  "git push origin +refs/heads/master",
];

export function validatePolicyAgainstInvariants(policy: PolicyConfig): void {
  for (const cmd of INVARIANT_PROBE_COMMANDS) {
    const probe: ToolRequest = {
      tool_name: "Bash",
      tool_input: { command: cmd },
      cwd: "/probe",
      session_id: "policy-validation-probe",
    };

    // この probe は本来 invariant でブロックされるはず。
    const invariantHit = matchInvariant(probe);
    if (!invariantHit) continue;

    // invariants を一時的に無効化して、ルール側で allow になるか調べる。
    const decisionWithoutInvariants = decideWithoutInvariants(probe, policy);
    if (decisionWithoutInvariants === "allow") {
      throw new PolicyLoadError(
        `invariant "${invariantHit.name}" が deny する操作を、ユーザールールが allow にしようとしています: ${cmd}`,
      );
    }
  }
}

/**
 * invariants を経由しないで policy.rules + default だけで決めた action を返す。
 * （invariants 上書き検出用なので、engine.decide とは独立に書く。）
 */
function decideWithoutInvariants(req: ToolRequest, policy: PolicyConfig): string {
  for (const rule of policy.rules) {
    if (matchesProbeRule(rule.when, req)) {
      return rule.action;
    }
  }
  return policy.defaults.unknown;
}

function matchesProbeRule(when: PolicyConfig["rules"][number]["when"], req: ToolRequest): boolean {
  if (when.tool !== undefined) {
    const tools = Array.isArray(when.tool) ? when.tool : [when.tool];
    if (!tools.includes(req.tool_name)) return false;
  }
  if (when.command_matches !== undefined) {
    const cmd = typeof req.tool_input.command === "string" ? req.tool_input.command : "";
    try {
      if (!new RegExp(when.command_matches, "u").test(cmd)) return false;
    } catch {
      return false;
    }
  }
  // probe では path/url/repo/time の when は無視する (invariants は Bash しか守らないため)。
  return true;
}

/**
 * YAML に書かれた正規表現が壊れていないか起動時に検査。
 *
 * policy.yaml (手書き) の invalid regex は起動エラーにする。
 * policy.generated.yaml (自動生成) の invalid regex は warn して
 * そのルールを無効化する (daemon クラッシュより degraded 動作を優先)。
 */
export function validatePolicyRegexes(
  policy: PolicyConfig,
  opts: { warnOnly?: boolean; onWarn?: (msg: string) => void } = {},
): void {
  const bad: PolicyConfig["rules"][number][] = [];
  for (const rule of policy.rules) {
    for (const key of ["command_matches", "path_matches", "url_matches"] as const) {
      const src = rule.when[key];
      if (src === undefined) continue;
      try {
        new RegExp(src, "u");
      } catch (err) {
        const msg = `ルール "${rule.name}" の ${key} が不正な正規表現です: ${(err as Error).message}`;
        if (opts.warnOnly) {
          opts.onWarn?.(msg);
          bad.push(rule);
        } else {
          throw new PolicyLoadError(msg);
        }
      }
    }
  }
  // bad rules から除外 (in-place で rules を絞る)
  if (bad.length > 0) {
    const badSet = new Set(bad);
    policy.rules = policy.rules.filter((r) => !badSet.has(r));
  }
}
