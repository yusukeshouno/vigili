import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TranscriptLine } from "@vigili/shared";
import { asRecord, clip, strField } from "./util.js";

const useColor = process.stdout.isTTY === true;

function dim(s: string): string {
  return useColor ? `\x1b[2m${s}\x1b[0m` : s;
}

function bold(s: string): string {
  return useColor ? `\x1b[1m${s}\x1b[0m` : s;
}

/**
 * Render the textual / tool parts of an assistant or user message.
 * We intentionally walk the structure generically (via asRecord) rather than
 * importing @anthropic-ai/sdk's MessageParam / content-block types, which keeps
 * the runner decoupled from that package's typings.
 */
function renderContent(message: unknown, who: string): void {
  const msg = asRecord(message);
  if (msg === null) {
    return;
  }
  const content = msg.content;

  if (typeof content === "string") {
    if (content.trim() !== "") {
      console.log(`${bold(who)} ${content}`);
    }
    return;
  }

  if (!Array.isArray(content)) {
    return;
  }

  for (const part of content) {
    const block = asRecord(part);
    if (block === null) {
      continue;
    }
    const type = strField(block, "type");
    switch (type) {
      case "text": {
        const text = strField(block, "text");
        if (text !== null && text.trim() !== "") {
          console.log(`${bold(who)} ${text}`);
        }
        break;
      }
      case "thinking": {
        const thinking = strField(block, "thinking");
        if (thinking !== null && thinking.trim() !== "") {
          console.log(dim(`  (thinking) ${thinking}`));
        }
        break;
      }
      case "tool_use": {
        const name = strField(block, "name") ?? "tool";
        console.log(dim(`  → ${name}`));
        break;
      }
      case "tool_result": {
        // Tool results echo back into the user turn; keep them quiet.
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Walk a message's content into transcript lines for the daemon fan-out.
 * `who` is the role for plain text; tool_use blocks are tagged role "tool".
 * Thinking blocks and tool_result echoes are dropped to keep the phone view lean.
 */
function contentToLines(message: unknown, who: "assistant" | "user", at: number): TranscriptLine[] {
  const msg = asRecord(message);
  if (msg === null) {
    return [];
  }
  const content = msg.content;
  const lines: TranscriptLine[] = [];

  if (typeof content === "string") {
    if (content.trim() !== "") {
      lines.push({ role: who, text: content, at });
    }
    return lines;
  }
  if (!Array.isArray(content)) {
    return lines;
  }

  for (const part of content) {
    const block = asRecord(part);
    if (block === null) {
      continue;
    }
    const type = strField(block, "type");
    if (type === "text") {
      const text = strField(block, "text");
      if (text !== null && text.trim() !== "") {
        lines.push({ role: who, text, at });
      }
    } else if (type === "tool_use") {
      const name = strField(block, "name") ?? "tool";
      const summary = summarizeBlockInput(block);
      lines.push({
        role: "tool",
        text: summary !== "" ? `${name}: ${summary}` : name,
        tool_name: name,
        at,
      });
    }
  }
  return lines;
}

/** Best-effort short description of a tool_use block's input. */
function summarizeBlockInput(block: Record<string, unknown>): string {
  const input = asRecord(block.input);
  if (input === null) {
    return "";
  }
  for (const key of ["command", "file_path", "path", "pattern", "url", "description"]) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) {
      return clip(v, 80);
    }
  }
  return "";
}

/**
 * Convert an SDK message into transcript lines to forward to the daemon.
 * Mirrors `renderMessage`'s selection but yields structured lines instead of
 * writing to stdout.
 */
export function toTranscriptLines(m: SDKMessage): TranscriptLine[] {
  const at = Date.now();
  switch (m.type) {
    case "system": {
      if (m.subtype === "init") {
        return [{ role: "system", text: `session ${m.session_id} · model ${m.model}`, at }];
      }
      return [];
    }
    case "assistant":
      return contentToLines(m.message, "assistant", at);
    case "user":
      return contentToLines(m.message, "user", at);
    case "result": {
      if (m.subtype === "success") {
        return [
          {
            role: "system",
            text: `[done] cost=$${m.total_cost_usd.toFixed(4)} turns=${m.num_turns}`,
            at,
          },
        ];
      }
      return [{ role: "system", text: `[ended: ${m.subtype}]`, at }];
    }
    default:
      return [];
  }
}

/** Pretty-print a single SDK message to stdout. */
export function renderMessage(m: SDKMessage): void {
  switch (m.type) {
    case "system": {
      if (m.subtype === "init") {
        console.log(dim(`[session ${m.session_id}] model=${m.model} cwd=${m.cwd}`));
      }
      break;
    }
    case "assistant": {
      renderContent(m.message, "claude>");
      break;
    }
    case "user": {
      renderContent(m.message, "you>");
      break;
    }
    case "result": {
      if (m.subtype === "success") {
        console.log(dim(`[done] cost=$${m.total_cost_usd.toFixed(4)} turns=${m.num_turns}`));
      } else {
        console.log(dim(`[ended: ${m.subtype}]`));
      }
      break;
    }
    default:
      break;
  }
}
