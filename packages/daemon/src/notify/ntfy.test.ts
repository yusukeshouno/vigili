import type { ApprovalRequest } from "@vigili/shared";
import { describe, expect, it } from "vitest";
import { createNtfyNotifier, formatBody } from "./ntfy.js";

const baseReq: ApprovalRequest = {
  id: "00000000-0000-4000-8000-000000000000",
  created_at: 1700000000000,
  resolved_at: null,
  session_id: "s",
  session_tag: "wiki",
  tool_name: "Bash",
  tool_input: { command: "curl https://api.example.com" },
  cwd: "/Users/me/wiki",
  decision: null,
  decided_by: null,
  reason: null,
};

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeFakeFetcher() {
  const calls: CapturedCall[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  return { calls, fetcher };
}

describe("createNtfyNotifier", () => {
  it("POSTs to topic URL", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      {
        server: "https://ntfy.sh",
        topic: "sentinel-test",
        priority: { normal: 3, critical: 5 },
      },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "normal", ruleSource: "rule:foo" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ntfy.sh/sentinel-test");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("maps critical to priority 5", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      {
        server: "https://ntfy.sh",
        topic: "t",
        priority: { normal: 3, critical: 5 },
      },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "critical", ruleSource: "rule:dangerous" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Priority"]).toBe("5");
    expect(headers["X-Tags"]).toContain("warning");
  });

  it("maps normal to configured normal priority", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      {
        server: "https://ntfy.sh",
        topic: "t",
        priority: { normal: 2, critical: 5 },
      },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "normal", ruleSource: "rule:foo" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Priority"]).toBe("2");
  });

  it("title includes rule source (percent-encoded for non-ASCII)", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      { server: "https://ntfy.sh", topic: "t", priority: { normal: 3, critical: 5 } },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "normal", ruleSource: "rule:未分類の Bash" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    // ASCII はそのまま、非 ASCII (日本語) は UTF-8 percent-encoded で出る。
    expect(headers["X-Title"]).toBe(`Vigili: rule:${encodeURIComponent("未分類の")} Bash`);
    // 全 byte が ASCII (fetch の ByteString 制約を満たす) か検査
    for (let i = 0; i < headers["X-Title"]?.length; i++) {
      expect(headers["X-Title"]?.charCodeAt(i)).toBeLessThan(0x80);
    }
  });

  it("does not throw when fetcher fails", async () => {
    const log: string[] = [];
    const failingFetch = async () => {
      throw new Error("network down");
    };
    const n = createNtfyNotifier(
      { server: "https://ntfy.sh", topic: "t", priority: { normal: 3, critical: 5 } },
      failingFetch,
      (m) => log.push(m),
    );
    await expect(
      n.notify({ request: baseReq, level: "normal", ruleSource: "x" }),
    ).resolves.toBeUndefined();
    expect(log.some((m) => m.includes("network down"))).toBe(true);
  });

  it("URL-encodes topic", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      {
        server: "https://ntfy.sh",
        topic: "needs encoding",
        priority: { normal: 3, critical: 5 },
      },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "normal", ruleSource: "x" });
    expect(calls[0]?.url).toBe("https://ntfy.sh/needs%20encoding");
  });

  it("strips trailing slash from server", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      {
        server: "https://ntfy.sh/",
        topic: "t",
        priority: { normal: 3, critical: 5 },
      },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "normal", ruleSource: "x" });
    expect(calls[0]?.url).toBe("https://ntfy.sh/t");
  });

  it("includes X-Click with PWA detail URL when pwaBaseUrl is set", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      {
        server: "https://ntfy.sh",
        topic: "t",
        priority: { normal: 3, critical: 5 },
        pwaBaseUrl: "https://sentinel.tail-abc.ts.net/",
      },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "normal", ruleSource: "x" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Click"]).toBe(`https://sentinel.tail-abc.ts.net/r/${baseReq.id}`);
  });

  it("omits X-Click when pwaBaseUrl is not set", async () => {
    const { calls, fetcher } = makeFakeFetcher();
    const n = createNtfyNotifier(
      { server: "https://ntfy.sh", topic: "t", priority: { normal: 3, critical: 5 } },
      fetcher,
    );
    await n.notify({ request: baseReq, level: "normal", ruleSource: "x" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Click"]).toBeUndefined();
  });
});

describe("formatBody", () => {
  it("renders Bash command", () => {
    expect(formatBody(baseReq)).toBe("[wiki] $ curl https://api.example.com");
  });

  it("renders Edit with file_path", () => {
    const req: ApprovalRequest = {
      ...baseReq,
      tool_name: "Edit",
      tool_input: { file_path: ".env", old_string: "x", new_string: "y" },
    };
    expect(formatBody(req)).toBe("[wiki] Edit .env");
  });

  it("renders WebFetch with url", () => {
    const req: ApprovalRequest = {
      ...baseReq,
      tool_name: "WebFetch",
      tool_input: { url: "https://x.example" },
    };
    expect(formatBody(req)).toBe("[wiki] WebFetch https://x.example");
  });

  it("uses ? when session_tag missing", () => {
    const req: ApprovalRequest = { ...baseReq, session_tag: null };
    expect(formatBody(req)).toBe("[?] $ curl https://api.example.com");
  });
});
