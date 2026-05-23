/**
 * 人間 → Claude Code のメッセージキュー。
 *
 * 仕様:
 * - session_id ごとの FIFO (created_at 昇順)
 * - exactly-once: 一度 drain したら delivered_at が set されて再配送されない
 * - insert/drain は同じ DB トランザクション内で安全 (better-sqlite3 はシリアル)
 *
 * テーブル定義は openStore() と同じ DB に作る (queue.db に同居)。
 * 既存テーブルへの追加 migration として MIGRATIONS に列挙する。
 */

import type Database from "better-sqlite3";
import { type Message, MessageSchema } from "@vigili/shared";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER
  )`,
  // 未配送だけ高速に引くための部分 index
  `CREATE INDEX IF NOT EXISTS idx_messages_undelivered
     ON messages(session_id, created_at) WHERE delivered_at IS NULL`,
];

interface Row {
  id: string;
  session_id: string;
  body: string;
  created_at: number;
  delivered_at: number | null;
}

export interface InsertMessageInput {
  id: string;
  session_id: string;
  body: string;
  created_at: number;
}

export interface MessageStore {
  insert(input: InsertMessageInput): Message;
  /**
   * session_id 宛の未配送メッセージを古い順に取り、同トランザクション内で
   * delivered_at = now を set する。
   * 返り値は drain した配列 (delivered_at は now にセット済み)。
   */
  drainForSession(session_id: string, now: number): Message[];
  /** UI 表示用: 全 message を created_at 降順で limit 件。 */
  listRecent(limit: number): Message[];
  /** test 用: 未配送だけ全件 */
  listUndelivered(): Message[];
}

export function createMessageStore(db: Database.Database): MessageStore {
  for (const sql of MIGRATIONS) db.exec(sql);

  const insertStmt = db.prepare<[string, string, string, number]>(
    `INSERT INTO messages (id, session_id, body, created_at) VALUES (?, ?, ?, ?)`,
  );
  const selectUndeliveredStmt = db.prepare<[string]>(
    `SELECT * FROM messages
       WHERE session_id = ? AND delivered_at IS NULL
       ORDER BY created_at ASC`,
  );
  const markDeliveredStmt = db.prepare<[number, string]>(
    `UPDATE messages SET delivered_at = ? WHERE id = ?`,
  );
  const listRecentStmt = db.prepare<[number]>(
    `SELECT * FROM messages ORDER BY created_at DESC LIMIT ?`,
  );
  const listUndeliveredAllStmt = db.prepare(
    `SELECT * FROM messages WHERE delivered_at IS NULL ORDER BY created_at ASC`,
  );

  const rowToMessage = (r: Row): Message =>
    MessageSchema.parse({
      id: r.id,
      session_id: r.session_id,
      body: r.body,
      created_at: r.created_at,
      delivered_at: r.delivered_at,
    });

  // drain は read + update を 1 トランザクションでやる (重複配送防止)
  const drainTxn = db.transaction((session_id: string, now: number): Message[] => {
    const rows = selectUndeliveredStmt.all(session_id) as Row[];
    for (const r of rows) {
      markDeliveredStmt.run(now, r.id);
      r.delivered_at = now;
    }
    return rows.map(rowToMessage);
  });

  return {
    insert(input) {
      insertStmt.run(input.id, input.session_id, input.body, input.created_at);
      return MessageSchema.parse({
        id: input.id,
        session_id: input.session_id,
        body: input.body,
        created_at: input.created_at,
        delivered_at: null,
      });
    },
    drainForSession(session_id, now) {
      return drainTxn(session_id, now);
    },
    listRecent(limit) {
      return (listRecentStmt.all(limit) as Row[]).map(rowToMessage);
    },
    listUndelivered() {
      return (listUndeliveredAllStmt.all() as Row[]).map(rowToMessage);
    },
  };
}
