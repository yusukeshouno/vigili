"use client";

import { type IDBPDatabase, openDB } from "idb";

/**
 * PWA の設定 (daemon URL + token) を IndexedDB に保存する。
 * SPEC §4.4: token は IndexedDB に保存。
 */

// 既存ユーザの token / URL を保持するため "sentinel" のまま残している。
// "vigili" への rename は migration コード (旧 DB から読んで新 DB へ書き戻す) と
// セットでないと初回起動時に setup を要求してしまう。次の breaking change と一緒に。
const DB_NAME = "sentinel";
const STORE = "config";
const VERSION = 1;
const KEY = "v1";

export interface PwaConfig {
  /** daemon の HTTP base URL。例: http://localhost:7878, https://my-machine.tail-XXXX.ts.net */
  daemonUrl: string;
  token: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function loadConfig(): Promise<PwaConfig | null> {
  const db = await getDb();
  const value = (await db.get(STORE, KEY)) as PwaConfig | undefined;
  return value ?? null;
}

export async function saveConfig(config: PwaConfig): Promise<void> {
  const db = await getDb();
  await db.put(STORE, config, KEY);
}

export async function clearConfig(): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, KEY);
}

/** daemonUrl から WebSocket URL を組み立てる。http→ws, https→wss。 */
export function buildWsUrl(daemonUrl: string, token: string): string {
  const url = new URL(daemonUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/ws`;
  url.searchParams.set("token", token);
  return url.toString();
}
