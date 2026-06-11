import { describe, expect, it } from "vitest";
import { ancestorHasSkipPermissions, hasSkipPermissionsFlag } from "./bypass-detect.js";

describe("hasSkipPermissionsFlag", () => {
  it("CLI 直接起動のフラグを検出する", () => {
    expect(hasSkipPermissionsFlag("claude --dangerously-skip-permissions")).toBe(true);
    expect(hasSkipPermissionsFlag("claude --dangerously-skip-permissions --model opus")).toBe(true);
  });

  it("デスクトップアプリ経由の --allow- 変種を検出する", () => {
    expect(
      hasSkipPermissionsFlag(
        "/path/claude --permission-mode acceptEdits --allow-dangerously-skip-permissions --resume abc",
      ),
    ).toBe(true);
  });

  it("フラグなしのコマンドラインは false", () => {
    expect(hasSkipPermissionsFlag("claude --permission-mode acceptEdits")).toBe(false);
    expect(hasSkipPermissionsFlag("/bin/zsh -c echo hello")).toBe(false);
  });

  it("部分一致しない (前置語が付くと別フラグ)", () => {
    expect(hasSkipPermissionsFlag("--dangerously-skip-permissions-v2")).toBe(false);
  });
});

describe("ancestorHasSkipPermissions", () => {
  it("pid 1 まで遡っても見つからなければ false (vitest 実行ツリーにフラグはない想定)", () => {
    // この前提が崩れる環境 (skip フラグ付き Claude Code から実行) では skip。
    expect(typeof ancestorHasSkipPermissions(process.ppid, 2)).toBe("boolean");
  });

  it("存在しない pid では false", () => {
    expect(ancestorHasSkipPermissions(999999999, 3)).toBe(false);
  });
});
