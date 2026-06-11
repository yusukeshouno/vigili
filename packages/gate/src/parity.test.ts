import { describe, expect, it } from "vitest";
import { NO_PROMPT_TOOLS, nativeParityPassthrough } from "./parity.js";

describe("nativeParityPassthrough", () => {
  it("読み取り専用の組み込みツールは permission_mode に関わらず素通し", () => {
    for (const tool of ["Read", "Glob", "Grep", "TodoWrite", "WebSearch", "Task"]) {
      expect(nativeParityPassthrough({ tool_name: tool }, undefined)).toMatch(/no-prompt/);
      expect(nativeParityPassthrough({ tool_name: tool }, "default")).toMatch(/no-prompt/);
    }
  });

  it("Bash / Edit / Write は default モードでは素通ししない (daemon に流す)", () => {
    expect(nativeParityPassthrough({ tool_name: "Bash" }, "default")).toBeNull();
    expect(nativeParityPassthrough({ tool_name: "Bash" }, undefined)).toBeNull();
    expect(nativeParityPassthrough({ tool_name: "Edit" }, "default")).toBeNull();
    expect(nativeParityPassthrough({ tool_name: "Write" }, undefined)).toBeNull();
  });

  it("bypassPermissions は全ツール素通し", () => {
    expect(nativeParityPassthrough({ tool_name: "Bash" }, "bypassPermissions")).toMatch(/bypass/);
    expect(nativeParityPassthrough({ tool_name: "Edit" }, "bypassPermissions")).toMatch(/bypass/);
  });

  it("plan モードは素通し (Claude Code 側が読み取り専用に制限済み)", () => {
    expect(nativeParityPassthrough({ tool_name: "Bash" }, "plan")).toMatch(/plan/);
  });

  it("acceptEdits は編集系のみ素通し、Bash は流す", () => {
    expect(nativeParityPassthrough({ tool_name: "Edit" }, "acceptEdits")).toMatch(/acceptEdits/);
    expect(nativeParityPassthrough({ tool_name: "Write" }, "acceptEdits")).toMatch(/acceptEdits/);
    expect(nativeParityPassthrough({ tool_name: "NotebookEdit" }, "acceptEdits")).toMatch(
      /acceptEdits/,
    );
    expect(nativeParityPassthrough({ tool_name: "Bash" }, "acceptEdits")).toBeNull();
    expect(nativeParityPassthrough({ tool_name: "WebFetch" }, "acceptEdits")).toBeNull();
  });

  it("未知の permission_mode は安全側 (default 扱いで流す)", () => {
    expect(nativeParityPassthrough({ tool_name: "Bash" }, "somethingNew")).toBeNull();
  });

  it("MCP ツールは素通ししない (Claude Code はデフォルトで確認を出すため)", () => {
    expect(nativeParityPassthrough({ tool_name: "mcp__foo__bar" }, "default")).toBeNull();
  });

  it("確認そのもののツール (ExitPlanMode) はリストに含まれない", () => {
    expect(NO_PROMPT_TOOLS.has("ExitPlanMode")).toBe(false);
    expect(nativeParityPassthrough({ tool_name: "ExitPlanMode" }, "default")).toBeNull();
  });
});
