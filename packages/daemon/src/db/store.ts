import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type ApprovalRequest, ApprovalRequestSchema, type FinalDecision } from "@vigili/shared";
import Database from "better-sqlite3";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    session_id TEXT NOT NULL,
    session_tag TEXT,
    tool_name TEXT NOT NULL,
    tool_input TEXT NOT NULL,
    cwd TEXT NOT NULL,
    decision TEXT,
    decided_by TEXT,
    reason TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pending
     ON approval_requests(decision) WHERE decision IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_created
     ON approval_requests(created_at DESC)`,
];

interface Row {
  id: string;
  created_at: number;
  resolved_at: number | null;
  session_id: string;
  session_tag: string | null;
  tool_name: string;
  tool_input: string;
  cwd: string;
  decision: FinalDecision | null;
  decided_by: string | null;
  reason: string | null;
}

export interface InsertRequestInput {
  id: string;
  created_at: number;
  session_id: string;
  session_tag: string | null;
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
}

export interface ResolveRequestInput {
  id: string;
  resolved_at: number;
  decision: FinalDecision;
  decided_by: string;
  reason: string | null;
}

export interface RequestStore {
  insert(input: InsertRequestInput): void;
  resolve(input: ResolveRequestInput): void;
  get(id: string): ApprovalRequest | null;
  listPending(): ApprovalRequest[];
  listRecent(limit: number): ApprovalRequest[];
  close(): void;
  /** stats / archive など低レベル query 用に raw DB と path を公開する。 */
  raw(): { db: Database.Database; path: string };
}

export function openStore(dbPath: string): RequestStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) db.exec(sql);

  const insertStmt = db.prepare<
    [string, number, string, string | null, string, string, string]
  >(`INSERT INTO approval_requests
    (id, created_at, session_id, session_tag, tool_name, tool_input, cwd)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  const resolveStmt = db.prepare<[number, FinalDecision, string, string | null, string]>(
    `UPDATE approval_requests
       SET resolved_at = ?, decision = ?, decided_by = ?, reason = ?
     WHERE id = ?`,
  );

  const getStmt = db.prepare<[string]>("SELECT * FROM approval_requests WHERE id = ?");
  const pendingStmt = db.prepare(
    "SELECT * FROM approval_requests WHERE decision IS NULL ORDER BY created_at ASC",
  );
  const recentStmt = db.prepare<[number]>(
    "SELECT * FROM approval_requests ORDER BY created_at DESC LIMIT ?",
  );

  const rowToRequest = (row: Row): ApprovalRequest => {
    return ApprovalRequestSchema.parse({
      id: row.id,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      session_id: row.session_id,
      session_tag: row.session_tag,
      tool_name: row.tool_name,
      tool_input: JSON.parse(row.tool_input) as Record<string, unknown>,
      cwd: row.cwd,
      decision: row.decision,
      decided_by: row.decided_by,
      reason: row.reason,
    });
  };

  return {
    insert(input) {
      insertStmt.run(
        input.id,
        input.created_at,
        input.session_id,
        input.session_tag,
        input.tool_name,
        JSON.stringify(input.tool_input),
        input.cwd,
      );
    },
    resolve(input) {
      resolveStmt.run(input.resolved_at, input.decision, input.decided_by, input.reason, input.id);
    },
    get(id) {
      const row = getStmt.get(id) as Row | undefined;
      return row ? rowToRequest(row) : null;
    },
    listPending() {
      return (pendingStmt.all() as Row[]).map(rowToRequest);
    },
    listRecent(limit) {
      return (recentStmt.all(limit) as Row[]).map(rowToRequest);
    },
    close() {
      db.close();
    },
    raw() {
      return { db, path: dbPath };
    },
  };
}
