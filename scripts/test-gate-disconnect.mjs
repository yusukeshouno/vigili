/**
 * test-gate-disconnect.mjs
 *
 * gate disconnect → Vigili 側の pending 削除を確認するテストスクリプト。
 *
 * 手順:
 *   1. daemon socket に gate と同じプロトコルで接続し、fake pending を 1 件 inject
 *   2. Vigili (iOS/Mac) に項目が現れたことを確認
 *   3. 3 秒後に socket を切断 (Claude Code が承認したときと同じ状態)
 *   4. Vigili から項目が自動的に消えることを確認
 *
 * 実行:
 *   node scripts/test-gate-disconnect.mjs
 */

import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SOCK = path.join(os.homedir(), ".vigili", "daemon.sock");
const WAIT_MS = 4000; // 切断まで待つ秒数

const req = {
  tool_name: "Bash",
  tool_input: { command: "echo 'テスト: gate disconnect 後に Vigili から消えるはず'" },
  cwd: process.cwd(),
  session_id: `test-${randomUUID()}`,
  session_tag: "TEST",
};

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(" gate disconnect テスト");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`socket: ${SOCK}`);
console.log(`tool  : ${req.tool_name}`);
console.log(`cmd   : ${req.tool_input.command}`);
console.log("");

const conn = net.createConnection(SOCK);

conn.once("connect", () => {
  console.log("✓ daemon に接続");
  conn.write(JSON.stringify(req) + "\n");
  console.log("✓ fake pending を inject しました");
  console.log("");
  console.log(`⟳ ${WAIT_MS / 1000} 秒後に切断します...`);
  console.log("  → 今すぐ Vigili (iOS/Mac) に pending が表示されているか確認してください");
  console.log("");

  // daemon からのレスポンスを読む（表示のみ）
  let buf = "";
  conn.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        console.log(`  daemon → ${line}`);
      }
    }
  });

  setTimeout(() => {
    console.log("⏹  socket を切断します (Claude Code が承認した状態を再現)");
    conn.destroy();
    console.log("✓ 切断完了");
    console.log("");
    console.log("  → Vigili から pending が消えていれば修正成功です！");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }, WAIT_MS);
});

conn.once("error", (err) => {
  console.error(`✗ 接続エラー: ${err.message}`);
  console.error("  daemon が起動しているか確認してください");
  process.exit(1);
});

conn.once("close", () => {
  process.exit(0);
});
