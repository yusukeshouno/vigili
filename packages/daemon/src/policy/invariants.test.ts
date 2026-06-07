import type { ToolRequest } from "@vigili/shared";
import { describe, expect, it } from "vitest";
import { matchInvariant } from "./invariants.js";

function bash(command: string): ToolRequest {
  return {
    tool_name: "Bash",
    tool_input: { command },
    cwd: "/tmp",
    session_id: "test",
  };
}

describe("matchInvariant", () => {
  it("blocks rm -rf /", () => {
    expect(matchInvariant(bash("rm -rf /"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("rm -rf /usr"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("rm -rf /*"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("sudo rm -rf /etc"))?.name).toBe("rm -rf root");
  });

  // security audit: フラグ順序/分割/long-form/クォートの等価別表記
  it("blocks rm -rf / bypass variants", () => {
    expect(matchInvariant(bash("rm -fr /"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("rm -r -f /"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("rm -f -r /"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("rm --recursive --force /"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("rm --force --recursive /"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash("rm -rf '/'"))?.name).toBe("rm -rf root");
    expect(matchInvariant(bash('rm -rf "/"'))?.name).toBe("rm -rf root");
  });

  it("blocks rm -rf ~/ patterns", () => {
    expect(matchInvariant(bash("rm -rf ~/"))?.name).toBe("rm -rf home");
    expect(matchInvariant(bash("rm -rf ~/Documents"))?.name).toBe("rm -rf home");
    expect(matchInvariant(bash("rm -rf $HOME/Downloads"))?.name).toBe("rm -rf home");
    expect(matchInvariant(bash("rm -fr ~/"))?.name).toBe("rm -rf home");
    expect(matchInvariant(bash("rm --recursive --force $HOME"))?.name).toBe("rm -rf home");
  });

  it("blocks git push --force to protected branches", () => {
    expect(matchInvariant(bash("git push --force origin main"))?.name).toBe(
      "force push to protected branch",
    );
    expect(matchInvariant(bash("git push -f origin master"))?.name).toBe(
      "force push to protected branch",
    );
    expect(matchInvariant(bash("git push --force-with-lease origin production"))?.name).toBe(
      "force push to protected branch",
    );
  });

  // security audit: フラグ後置 / refspec force の等価別表記
  it("blocks git force-push bypass variants", () => {
    expect(matchInvariant(bash("git push origin main --force"))?.name).toBe(
      "force push to protected branch",
    );
    expect(matchInvariant(bash("git push origin master -f"))?.name).toBe(
      "force push to protected branch",
    );
    expect(matchInvariant(bash("git push origin +main"))?.name).toBe(
      "force push to protected branch",
    );
    expect(matchInvariant(bash("git push origin +refs/heads/master"))?.name).toBe(
      "force push to protected branch",
    );
  });

  it("does not block safe commands", () => {
    expect(matchInvariant(bash("ls"))).toBeNull();
    expect(matchInvariant(bash("rm -rf node_modules"))).toBeNull();
    expect(matchInvariant(bash("rm -rf ./build"))).toBeNull();
    expect(matchInvariant(bash("git push origin feature-branch"))).toBeNull();
    expect(matchInvariant(bash("git push --force origin feature-x"))).toBeNull();
    // force だが保護ブランチでない / 保護ブランチだが force でない
    expect(matchInvariant(bash("git push origin develop --force"))).toBeNull();
    expect(matchInvariant(bash("git push origin main"))).toBeNull();
    // rm だが recursive のみ / force のみ (両方揃わなければ invariant 対象外)
    expect(matchInvariant(bash("rm -r /tmp/foo"))).toBeNull();
    expect(matchInvariant(bash("rm -f /tmp/foo"))).toBeNull();
    // 相対パス (絶対パス / でも home ~ でもない) は対象外
    expect(matchInvariant(bash("rm -rf ./build"))).toBeNull();
    expect(matchInvariant(bash("rm -rf node_modules"))).toBeNull();
  });

  it("does not block Edit/Write tools", () => {
    const req: ToolRequest = {
      tool_name: "Edit",
      tool_input: { file_path: "/", old_string: "x", new_string: "y" },
      cwd: "/tmp",
      session_id: "t",
    };
    expect(matchInvariant(req)).toBeNull();
  });
});
