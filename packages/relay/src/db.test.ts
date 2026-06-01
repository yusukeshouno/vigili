import { describe, expect, it } from "vitest";
import { openRelayStore } from "./db.js";

describe("openRelayStore", () => {
  it("creates and finds accounts by email", () => {
    const store = openRelayStore(":memory:");
    store.insertAccount({
      id: "a-1",
      email: "shono@neort.io",
      password_hash: "scrypt$00$00",
      created_at: 1,
    });
    expect(store.findAccountByEmail("shono@neort.io")?.id).toBe("a-1");
    expect(store.findAccountByEmail("nobody@example.com")).toBeNull();
    store.close();
  });

  it("rejects duplicate emails via UNIQUE constraint", () => {
    const store = openRelayStore(":memory:");
    store.insertAccount({
      id: "a-1",
      email: "x@y.z",
      password_hash: "h",
      created_at: 1,
    });
    expect(() =>
      store.insertAccount({ id: "a-2", email: "x@y.z", password_hash: "h", created_at: 2 }),
    ).toThrow();
    store.close();
  });

  it("deletes expired sessions and rejects expired ones via TTL purge", () => {
    const store = openRelayStore(":memory:");
    store.insertAccount({ id: "a-1", email: "x@y.z", password_hash: "h", created_at: 1 });
    store.insertSession({
      token_hash: "fresh",
      account_id: "a-1",
      created_at: 100,
      expires_at: 200,
      last_used_at: 100,
    });
    store.insertSession({
      token_hash: "stale",
      account_id: "a-1",
      created_at: 50,
      expires_at: 60,
      last_used_at: 50,
    });
    const purged = store.deleteExpiredSessions(150);
    expect(purged).toBe(1);
    expect(store.findSession("fresh")).not.toBeNull();
    expect(store.findSession("stale")).toBeNull();
    store.close();
  });

  it("cascades pairings on account deletion", () => {
    const store = openRelayStore(":memory:");
    store.insertAccount({ id: "a-1", email: "x@y.z", password_hash: "h", created_at: 1 });
    store.insertPairing({
      id: "p-1",
      account_id: "a-1",
      name: "mac",
      agent_key_hash: "ak",
      user_token_hash: "ut",
      created_at: 1,
    });
    store.raw().prepare("DELETE FROM accounts WHERE id = ?").run("a-1");
    expect(store.findPairingById("p-1")).toBeNull();
    store.close();
  });

  it("upserts devices by apns_token (latest pairing wins)", () => {
    const store = openRelayStore(":memory:");
    store.insertAccount({ id: "a-1", email: "x@y.z", password_hash: "h", created_at: 1 });
    store.insertPairing({
      id: "p-1",
      account_id: "a-1",
      name: null,
      agent_key_hash: "ak",
      user_token_hash: "ut",
      created_at: 1,
    });
    store.insertPairing({
      id: "p-2",
      account_id: "a-1",
      name: null,
      agent_key_hash: "ak2",
      user_token_hash: "ut2",
      created_at: 2,
    });
    store.upsertDevice({
      id: "d-1",
      account_id: "a-1",
      pairing_id: "p-1",
      apns_token: "tok",
      platform: "ios",
      last_seen_at: 1,
      created_at: 1,
    });
    store.upsertDevice({
      id: "d-2",
      account_id: "a-1",
      pairing_id: "p-2",
      apns_token: "tok",
      platform: "ios",
      last_seen_at: 2,
      created_at: 2,
    });
    const devices = store.listDevicesForPairing("p-2");
    expect(devices).toHaveLength(1);
    expect(store.listDevicesForPairing("p-1")).toHaveLength(0);
    store.close();
  });

  it("creates + finds Apple accounts by sub and keeps them distinct from email accounts", () => {
    const store = openRelayStore(":memory:");
    store.insertAppleAccount({
      id: "apple-1",
      email: "appleid:sub-xyz",
      apple_sub: "sub-xyz",
      created_at: 1,
    });
    const found = store.findAccountByAppleSub("sub-xyz");
    expect(found?.id).toBe("apple-1");
    expect(found?.apple_sub).toBe("sub-xyz");
    expect(found?.password_hash).toBe(""); // sentinel — signin できない
    expect(store.findAccountByAppleSub("nope")).toBeNull();
    // email/password アカウントは apple_sub=null
    store.insertAccount({ id: "e-1", email: "e@x.co", password_hash: "scrypt$0$0", created_at: 2 });
    expect(store.findAccountById("e-1")?.apple_sub).toBeNull();
    store.close();
  });

  it("lists devices for an account regardless of pairing_id", () => {
    const store = openRelayStore(":memory:");
    store.insertAppleAccount({ id: "acc", email: "appleid:s", apple_sub: "s", created_at: 1 });
    store.upsertDevice({
      id: "d-1",
      account_id: "acc",
      pairing_id: null, // account-level device
      apns_token: "acctdev",
      platform: "ios",
      last_seen_at: 1,
      created_at: 1,
    });
    expect(store.listDevicesForAccount("acc")).toHaveLength(1);
    expect(store.listDevicesForPairing("acc")).toHaveLength(0); // pairing 経路では出ない
    store.close();
  });
});
