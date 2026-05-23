import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRequest } from "@sentinel/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StoredSubscription,
  type SubscriptionStore,
  type VapidKeys,
  type WebPushSender,
  buildPayload,
  createWebPushNotifier,
  loadOrCreateVapidKeys,
  openSubscriptionStore,
} from "./web-push.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "sentinel-push-"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadOrCreateVapidKeys", () => {
  it("initial run generates a key pair", () => {
    const path = join(tmp, "vapid.json");
    const keys = loadOrCreateVapidKeys(path, "mailto:test@local");
    expect(keys.publicKey.length).toBeGreaterThan(20);
    expect(keys.privateKey.length).toBeGreaterThan(20);
    expect(keys.subject).toBe("mailto:test@local");
    const onDisk = JSON.parse(readFileSync(path, "utf-8")) as VapidKeys;
    expect(onDisk.publicKey).toBe(keys.publicKey);
  });

  it("subsequent runs reuse the persisted key", () => {
    const path = join(tmp, "vapid.json");
    const first = loadOrCreateVapidKeys(path, "mailto:a@b");
    const second = loadOrCreateVapidKeys(path, "mailto:other@x");
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.privateKey).toBe(first.privateKey);
    // subject はファイル優先
    expect(second.subject).toBe("mailto:a@b");
  });

  it("regenerates when the file is corrupted", () => {
    const path = join(tmp, "vapid.json");
    require("node:fs").writeFileSync(path, "not json");
    const keys = loadOrCreateVapidKeys(path, "mailto:t@x");
    expect(keys.publicKey.length).toBeGreaterThan(20);
  });
});

describe("openSubscriptionStore", () => {
  function makeSub(endpoint: string, createdAt = 1): StoredSubscription {
    return {
      endpoint,
      keys: { p256dh: "p", auth: "a" },
      created_at: createdAt,
    };
  }

  it("starts empty when file is missing", () => {
    const store = openSubscriptionStore(join(tmp, "subs.json"));
    expect(store.size()).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it("add persists, list returns a copy", () => {
    const path = join(tmp, "subs.json");
    const store = openSubscriptionStore(path);
    store.add(makeSub("https://push.example/a"));
    expect(store.size()).toBe(1);
    const onDisk = JSON.parse(readFileSync(path, "utf-8")) as StoredSubscription[];
    expect(onDisk[0]?.endpoint).toBe("https://push.example/a");

    // 同じ store を再オープンしても残っている
    const reopened = openSubscriptionStore(path);
    expect(reopened.size()).toBe(1);
  });

  it("add with duplicate endpoint overwrites", () => {
    const store = openSubscriptionStore(join(tmp, "subs.json"));
    store.add(makeSub("https://push.example/a", 100));
    store.add(makeSub("https://push.example/a", 200));
    expect(store.size()).toBe(1);
    expect(store.list()[0]?.created_at).toBe(200);
  });

  it("remove returns true/false correctly", () => {
    const store = openSubscriptionStore(join(tmp, "subs.json"));
    store.add(makeSub("https://push.example/a"));
    expect(store.remove("https://push.example/a")).toBe(true);
    expect(store.remove("https://push.example/a")).toBe(false);
    expect(store.size()).toBe(0);
  });
});

describe("buildPayload", () => {
  function req(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
    return {
      id: "req-123",
      created_at: 0,
      resolved_at: null,
      session_id: "s",
      session_tag: "neort",
      tool_name: "Bash",
      tool_input: { command: "ls -la /tmp" },
      cwd: "/tmp",
      decision: null,
      decided_by: null,
      reason: null,
      ...overrides,
    } as ApprovalRequest;
  }

  it("Bash → command が body に出る", () => {
    const p = buildPayload(
      { request: req(), level: "normal", ruleSource: "rule:long bash" },
      "https://my.tail.ts.net",
    );
    expect(p.title).toBe("[neort] Sentinel — rule:long bash");
    expect(p.body).toBe("$ ls -la /tmp");
    expect(p.url).toBe("https://my.tail.ts.net/r/req-123");
    expect(p.tag).toBe("req-123");
    expect(p.level).toBe("normal");
  });

  it("Edit → tool 名 + path が出る", () => {
    const r = req({
      tool_name: "Edit",
      tool_input: { file_path: "/repo/.env", new_string: "x" },
    });
    const p = buildPayload({ request: r, level: "critical", ruleSource: "rule:secret" }, undefined);
    expect(p.body).toBe("Edit /repo/.env");
    expect(p.url).toBe("/r/req-123"); // base 無いとき相対 URL
    expect(p.level).toBe("critical");
  });

  it("session_tag が無い時は '?' になる", () => {
    const r = req({ session_tag: null });
    const p = buildPayload(
      { request: r, level: "normal", ruleSource: "rule:any" },
      "https://x.example/",
    );
    expect(p.title).toBe("[?] Sentinel — rule:any");
  });
});

describe("createWebPushNotifier", () => {
  const vapid: VapidKeys = {
    publicKey: "pub",
    privateKey: "priv",
    subject: "mailto:t@x",
  };

  function freshStore(): SubscriptionStore {
    const store = openSubscriptionStore(join(tmp, `subs-${Math.random()}.json`));
    store.add({
      endpoint: "https://push.a/1",
      keys: { p256dh: "p", auth: "a" },
      created_at: 1,
    });
    store.add({
      endpoint: "https://push.b/2",
      keys: { p256dh: "p", auth: "a" },
      created_at: 2,
    });
    return store;
  }

  function input(level: "normal" | "critical" = "normal") {
    return {
      request: {
        id: "abc",
        created_at: 0,
        resolved_at: null,
        session_id: "s",
        session_tag: "tag",
        tool_name: "Bash" as const,
        tool_input: { command: "echo hi" },
        cwd: "/",
        decision: null,
        decided_by: null,
        reason: null,
      } as ApprovalRequest,
      level,
      ruleSource: "rule:x",
    };
  }

  it("subscription が無い時は send されない", async () => {
    const store = openSubscriptionStore(join(tmp, "empty.json"));
    const sender = vi.fn<Parameters<WebPushSender>, ReturnType<WebPushSender>>();
    const n = createWebPushNotifier({ vapid, store, sender, log: () => {} });
    await n.notify(input());
    expect(sender).not.toHaveBeenCalled();
  });

  it("成功時に全 subscription に並列 POST する", async () => {
    const store = freshStore();
    const sender = vi.fn(async () => ({ statusCode: 201 }));
    const n = createWebPushNotifier({ vapid, store, sender, log: () => {} });
    await n.notify(input("critical"));
    expect(sender).toHaveBeenCalledTimes(2);
    const call0 = sender.mock.calls[0]!;
    expect(call0[1]).toContain('"title"'); // payload が JSON 文字列
    expect(call0[2].urgency).toBe("high");
    expect(call0[2].TTL).toBe(300);
    expect(call0[2].vapidDetails.publicKey).toBe("pub");
  });

  it("410 / 404 が返ると subscription を削除する", async () => {
    const store = freshStore();
    expect(store.size()).toBe(2);
    const sender = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/1")) {
        // web-push は throw する
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }
      return { statusCode: 201 };
    });
    const n = createWebPushNotifier({ vapid, store, sender, log: () => {} });
    await n.notify(input());
    expect(store.size()).toBe(1);
    expect(store.list()[0]?.endpoint).toBe("https://push.b/2");
  });

  it("一時的なエラー (500) では subscription を消さない", async () => {
    const store = freshStore();
    const sender = vi.fn(async () => {
      throw Object.assign(new Error("server error"), { statusCode: 500 });
    });
    const n = createWebPushNotifier({ vapid, store, sender, log: () => {} });
    await n.notify(input());
    expect(store.size()).toBe(2); // 残る
  });
});
