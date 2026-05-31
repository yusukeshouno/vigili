/**
 * Sentinel Relay の永続化層。
 *
 * MVP では SQLite (better-sqlite3) を使い、Postgres 移行は需要が出てから。
 * テーブルは accounts / sessions / pairings / devices の 4 種類。
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_account
     ON sessions(account_id)`,
  `CREATE TABLE IF NOT EXISTS pairings (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT,
    agent_key_hash TEXT NOT NULL,
    user_token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pairings_account
     ON pairings(account_id)`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    pairing_id TEXT REFERENCES pairings(id) ON DELETE SET NULL,
    apns_token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_devices_pairing
     ON devices(pairing_id)`,
];

export interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
}

export interface SessionRow {
  token_hash: string;
  account_id: string;
  created_at: number;
  expires_at: number;
  last_used_at: number;
}

export interface PairingRow {
  id: string;
  account_id: string;
  name: string | null;
  agent_key_hash: string;
  user_token_hash: string;
  created_at: number;
}

export interface DeviceRow {
  id: string;
  account_id: string;
  pairing_id: string | null;
  apns_token: string;
  platform: string;
  last_seen_at: number;
  created_at: number;
}

export interface RelayStore {
  // accounts
  insertAccount(row: AccountRow): void;
  findAccountByEmail(email: string): AccountRow | null;
  findAccountById(id: string): AccountRow | null;
  // sessions
  insertSession(row: SessionRow): void;
  findSession(tokenHash: string): SessionRow | null;
  touchSession(tokenHash: string, now: number): void;
  deleteSession(tokenHash: string): void;
  deleteExpiredSessions(now: number): number;
  // pairings
  insertPairing(row: PairingRow): void;
  findPairingById(id: string): PairingRow | null;
  listPairingsForAccount(accountId: string): PairingRow[];
  deletePairing(id: string, accountId: string): boolean;
  // devices
  upsertDevice(row: DeviceRow): void;
  listDevicesForPairing(pairingId: string): DeviceRow[];
  deleteDeviceByToken(apnsToken: string): boolean;
  // misc
  close(): void;
  raw(): Database.Database;
}

export function openRelayStore(dbPath: string): RelayStore {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) db.exec(sql);

  // accounts
  const insertAccountStmt = db.prepare<[string, string, string, number]>(
    `INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
  );
  const findAccountByEmailStmt = db.prepare<[string]>(`SELECT * FROM accounts WHERE email = ?`);
  const findAccountByIdStmt = db.prepare<[string]>(`SELECT * FROM accounts WHERE id = ?`);

  // sessions
  const insertSessionStmt = db.prepare<[string, string, number, number, number]>(
    `INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const findSessionStmt = db.prepare<[string]>(`SELECT * FROM sessions WHERE token_hash = ?`);
  const touchSessionStmt = db.prepare<[number, string]>(
    `UPDATE sessions SET last_used_at = ? WHERE token_hash = ?`,
  );
  const deleteSessionStmt = db.prepare<[string]>(`DELETE FROM sessions WHERE token_hash = ?`);
  const deleteExpiredStmt = db.prepare<[number]>(`DELETE FROM sessions WHERE expires_at < ?`);

  // pairings
  const insertPairingStmt = db.prepare<[string, string, string | null, string, string, number]>(
    `INSERT INTO pairings (id, account_id, name, agent_key_hash, user_token_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const findPairingByIdStmt = db.prepare<[string]>(`SELECT * FROM pairings WHERE id = ?`);
  const listPairingsForAccountStmt = db.prepare<[string]>(
    `SELECT * FROM pairings WHERE account_id = ? ORDER BY created_at DESC`,
  );
  const deletePairingStmt = db.prepare<[string, string]>(
    `DELETE FROM pairings WHERE id = ? AND account_id = ?`,
  );

  // devices
  // (apns_token UNIQUE) upsert で「同じ端末トークンは最新の pairing に差し替える」運用。
  const upsertDeviceStmt = db.prepare<
    [string, string, string | null, string, string, number, number]
  >(
    `INSERT INTO devices (id, account_id, pairing_id, apns_token, platform, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(apns_token) DO UPDATE SET
       account_id = excluded.account_id,
       pairing_id = excluded.pairing_id,
       platform   = excluded.platform,
       last_seen_at = excluded.last_seen_at`,
  );
  const listDevicesForPairingStmt = db.prepare<[string]>(
    `SELECT * FROM devices WHERE pairing_id = ?`,
  );
  const deleteDeviceByTokenStmt = db.prepare<[string]>(`DELETE FROM devices WHERE apns_token = ?`);

  return {
    insertAccount(row) {
      insertAccountStmt.run(row.id, row.email, row.password_hash, row.created_at);
    },
    findAccountByEmail(email) {
      return (findAccountByEmailStmt.get(email) as AccountRow | undefined) ?? null;
    },
    findAccountById(id) {
      return (findAccountByIdStmt.get(id) as AccountRow | undefined) ?? null;
    },

    insertSession(row) {
      insertSessionStmt.run(
        row.token_hash,
        row.account_id,
        row.created_at,
        row.expires_at,
        row.last_used_at,
      );
    },
    findSession(tokenHash) {
      return (findSessionStmt.get(tokenHash) as SessionRow | undefined) ?? null;
    },
    touchSession(tokenHash, now) {
      touchSessionStmt.run(now, tokenHash);
    },
    deleteSession(tokenHash) {
      deleteSessionStmt.run(tokenHash);
    },
    deleteExpiredSessions(now) {
      const info = deleteExpiredStmt.run(now);
      return Number(info.changes);
    },

    insertPairing(row) {
      insertPairingStmt.run(
        row.id,
        row.account_id,
        row.name,
        row.agent_key_hash,
        row.user_token_hash,
        row.created_at,
      );
    },
    findPairingById(id) {
      return (findPairingByIdStmt.get(id) as PairingRow | undefined) ?? null;
    },
    listPairingsForAccount(accountId) {
      return listPairingsForAccountStmt.all(accountId) as PairingRow[];
    },
    deletePairing(id, accountId) {
      const info = deletePairingStmt.run(id, accountId);
      return Number(info.changes) > 0;
    },

    upsertDevice(row) {
      upsertDeviceStmt.run(
        row.id,
        row.account_id,
        row.pairing_id,
        row.apns_token,
        row.platform,
        row.last_seen_at,
        row.created_at,
      );
    },
    listDevicesForPairing(pairingId) {
      return listDevicesForPairingStmt.all(pairingId) as DeviceRow[];
    },
    deleteDeviceByToken(apnsToken) {
      const info = deleteDeviceByTokenStmt.run(apnsToken);
      return Number(info.changes) > 0;
    },

    close() {
      db.close();
    },
    raw() {
      return db;
    },
  };
}
