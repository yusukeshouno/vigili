import type { ToolRequest } from "@sentinel/shared";
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

  it("blocks rm -rf ~/ patterns", () => {
    expect(matchInvariant(bash("rm -rf ~/"))?.name).toBe("rm -rf home");
    expect(matchInvariant(bash("rm -rf ~/Documents"))?.name).toBe("rm -rf home");
    expect(matchInvariant(bash("rm -rf $HOME/Downloads"))?.name).toBe("rm -rf home");
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

  it("does not block safe commands", () => {
    expect(matchInvariant(bash("ls"))).toBeNull();
    expect(matchInvariant(bash("rm -rf node_modules"))).toBeNull();
    expect(matchInvariant(bash("rm -rf ./build"))).toBeNull();
    expect(matchInvariant(bash("git push origin feature-branch"))).toBeNull();
    expect(matchInvariant(bash("git push --force origin feature-x"))).toBeNull();
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
