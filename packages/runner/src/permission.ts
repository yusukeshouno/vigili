import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Question } from "@vigili/shared";
import type { DaemonConn } from "./daemon-conn.js";
import { type Io, askChoice, askYesNo } from "./io.js";
import { asRecord, strField, summarizeInput } from "./util.js";

/**
 * Tools that only observe state. We auto-allow these locally so the operator is
 * not nagged for read-only work. This local set is the daemon-less fallback; in
 * daemon mode the real Vigili policy engine classifies every tool instead.
 */
const READONLY = new Set<string>(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite"]);

/**
 * Pull the structured questions out of an AskUserQuestion tool input, shaped as
 * the shared `Question` type so the same parse feeds both the local prompt and
 * the daemon fan-out.
 */
export function parseQuestions(input: Record<string, unknown>): Question[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Question[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === null) {
      continue;
    }
    const question = strField(rec, "question");
    if (question === null) {
      continue;
    }
    const optionsRaw = rec.options;
    const options: Question["options"] = [];
    if (Array.isArray(optionsRaw)) {
      for (const opt of optionsRaw) {
        const optRec = asRecord(opt);
        if (optRec === null) {
          continue;
        }
        const label = strField(optRec, "label");
        if (label === null) {
          continue;
        }
        options.push({ label, description: strField(optRec, "description") ?? "" });
      }
    }
    out.push({
      question,
      header: strField(rec, "header") ?? "",
      multiSelect: rec.multiSelect === true,
      options,
    });
  }
  return out;
}

/** Resolve an AskUserQuestion prompt by asking the local operator each question. */
async function handleAskUserQuestion(
  io: Io,
  input: Record<string, unknown>,
): Promise<PermissionResult> {
  const questions = parseQuestions(input);
  if (questions.length === 0) {
    return { behavior: "deny", message: "AskUserQuestion had no parseable questions" };
  }

  const answers: Record<string, string> = {};
  for (const q of questions) {
    const header = q.header !== "" ? ` (${q.header})` : "";
    console.log(`\n? ${q.question}${header}`);
    q.options.forEach((opt, idx) => {
      const desc = opt.description !== "" ? ` — ${opt.description}` : "";
      console.log(`  ${idx + 1}. ${opt.label}${desc}`);
    });

    let label: string | null = null;
    while (label === null) {
      const picked = await askChoice(
        io,
        "  choose [number, or type free text]: ",
        q.options.length,
      );
      if (picked !== null) {
        const opt = q.options[picked];
        if (opt !== undefined) {
          label = opt.label;
        }
      } else {
        const free = await io.ask("  (no valid number — type your answer): ");
        if (free !== "") {
          label = free;
        }
      }
    }
    answers[q.question] = label;
  }

  return { behavior: "allow", updatedInput: { ...input, answers } };
}

/** Resolve an ExitPlanMode prompt by showing the plan and asking to approve. */
async function handleExitPlanMode(
  io: Io,
  input: Record<string, unknown>,
): Promise<PermissionResult> {
  const plan = strField(input, "plan") ?? "(no plan text)";
  console.log("\n--- proposed plan ---");
  console.log(plan);
  console.log("--- end plan ---");
  const ok = await askYesNo(io, "Approve this plan?", false);
  if (ok) {
    return { behavior: "allow", updatedInput: input };
  }
  return { behavior: "deny", message: "Plan rejected by operator" };
}

/**
 * Build a CanUseTool callback that resolves permissions against the local
 * terminal. This is the P0.5 local implementation; P1 swaps it for one that
 * forwards to the daemon over the unix socket.
 */
export function makeLocalCanUseTool(io: Io): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    if (toolName === "AskUserQuestion") {
      return handleAskUserQuestion(io, input);
    }
    if (toolName === "ExitPlanMode") {
      return handleExitPlanMode(io, input);
    }
    if (READONLY.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }

    const summary = summarizeInput(input);
    const ok = await askYesNo(io, `Allow ${toolName}: ${summary}?`, false);
    if (ok) {
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: `${toolName} denied by operator` };
  };
}

/**
 * Build a CanUseTool callback that routes every decision through the daemon:
 *  - AskUserQuestion  → `question`  (fanned out to clients, answered remotely)
 *  - ExitPlanMode     → `plan`      (approved/rejected remotely)
 *  - any other tool   → `permission-request` (Vigili policy engine + queue)
 *
 * This is the P1b path: the daemon is the authority, so read-only tools are NOT
 * short-circuited here — they go through the policy engine for full observability.
 * If the daemon drops mid-flight, the DaemonConn resolves fail-safe (deny / null).
 */
export function makeDaemonCanUseTool(conn: DaemonConn): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    if (toolName === "AskUserQuestion") {
      const questions = parseQuestions(input);
      if (questions.length === 0) {
        return { behavior: "deny", message: "AskUserQuestion had no parseable questions" };
      }
      const answers = await conn.askQuestion(questions);
      if (answers === null) {
        return { behavior: "deny", message: "question went unanswered (daemon disconnected)" };
      }
      return { behavior: "allow", updatedInput: { ...input, answers } };
    }

    if (toolName === "ExitPlanMode") {
      const plan = strField(input, "plan") ?? "(no plan text)";
      const outcome = await conn.requestPlan(plan);
      if (outcome.decision === "approve") {
        return { behavior: "allow", updatedInput: input };
      }
      return { behavior: "deny", message: outcome.reason ?? "Plan rejected" };
    }

    const outcome = await conn.requestPermission(toolName, input);
    if (outcome.decision === "allow") {
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: outcome.reason ?? `${toolName} denied` };
  };
}
