/**
 * Inject danger/caution pendings and KEEP them pending.
 *
 * Each request is sent over its own socket connection. While the daemon
 * answers "ask", the gate protocol keeps that connection open — so as long
 * as this process stays alive, the items remain in the queue and fan out to
 * every connected client (Mac popover + iOS simulator).
 *
 * Purpose: visually verify the RiskAssessment UX (red ⚠ banner, hidden
 * auto-approve) on both apps. Ctrl-C to clear (closing sockets cancels the
 * pendings).
 *
 *   node packages/app/scripts/inject-danger.mjs
 */

import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

const SOCKET = `${process.env.HOME}/.vigili/daemon.sock`;

// cwd は repo 外の架空パスにして allow ルールに当たらないようにする (= ask 化)。
const REQUESTS = [
  {
    tool_name: "Bash",
    tool_input: {
      command: "rsync -avz ./build/ deploy@prod-web-01:/srv/www/app/",
      description: "Push build to prod web server",
    },
    cwd: "/Users/shounoyusuke/work/billing-api",
    session_tag: "billing-api",
  },
  {
    tool_name: "Edit",
    tool_input: {
      file_path: "/Users/shounoyusuke/work/billing-api/.env.production",
      old_string: "STRIPE_KEY=sk_live_old",
      new_string: "STRIPE_KEY=sk_live_new",
    },
    cwd: "/Users/shounoyusuke/work/billing-api",
    session_tag: "billing-api",
  },
  {
    tool_name: "Edit",
    tool_input: {
      file_path: "/Users/shounoyusuke/work/frontend/docker-compose.prod.yml",
      old_string: "replicas: 2",
      new_string: "replicas: 4",
    },
    cwd: "/Users/shounoyusuke/work/frontend",
    session_tag: "frontend",
  },
];

const sockets = [];

function inject(payload) {
  return new Promise((resolve) => {
    const conn = createConnection(SOCKET);
    let buf = "";
    conn.on("connect", () => conn.write(`${JSON.stringify(payload)}\n`));
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      let first;
      try {
        first = JSON.parse(buf.slice(0, nl));
      } catch {
        first = { decision: "?", raw: buf.slice(0, nl) };
      }
      buf = buf.slice(nl + 1);
      const tag = payload.session_tag;
      if (first.decision === "ask") {
        console.log(`  [ask  ] ${tag} → pending (held open)`);
        sockets.push(conn); // 開いたまま保持
      } else {
        console.log(`  [${first.decision.padEnd(5)}] ${tag} → resolved immediately, not pending`);
        conn.destroy();
      }
      resolve();
    });
    conn.on("error", (err) => {
      console.error(`  [error] ${payload.session_tag}: ${err.message}`);
      resolve();
    });
  });
}

async function main() {
  console.log(`Injecting ${REQUESTS.length} requests → ${SOCKET}`);
  for (const r of REQUESTS) {
    await inject({ ...r, session_id: randomUUID() });
  }
  if (sockets.length === 0) {
    console.log("No pendings held. (All requests were auto-resolved by policy.)");
    process.exit(0);
  }
  console.log(`\n${sockets.length} pending held open. Inspect Mac popover + iOS sim.`);
  console.log("Ctrl-C to clear (closing sockets cancels the pendings).");
  // 8 分で自動終了 (askTimeout より短く)
  setTimeout(() => {
    console.log("\nAuto-exit after 8min; clearing pendings.");
    for (const s of sockets) s.destroy();
    process.exit(0);
  }, 8 * 60_000);
}

process.on("SIGINT", () => {
  console.log("\nClearing pendings…");
  for (const s of sockets) s.destroy();
  process.exit(0);
});

main();
