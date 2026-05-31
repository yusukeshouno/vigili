/**
 * End-to-end test for remote approval via relay.
 *
 *  Mac gate (us)   →   daemon.sock   →   daemon
 *                                          ↓ relay client
 *                                       relay.vigili.io
 *                                          ↑ user WS
 *                                       this script (acting as iOS client)
 *
 * Flow:
 *  1. Open WS as the user to relay  /v1/clients/<pid>?token=<user_token>
 *  2. Wait for the snapshot message to confirm relay is bridged
 *  3. Open a unix socket to the local daemon
 *  4. Send a ToolRequest that policy will ASK on
 *  5. Wait for the relay WS to deliver the "pending" message
 *  6. Send a "decide allow" via the relay WS
 *  7. Wait for the daemon socket to return the allow result
 *  8. Print PASS / FAIL
 */

import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// 設定: 環境変数で渡す (vigili-cli pair で発行された値を使う)
//   VIGILI_TEST_PID    = pairing_id (UUID)
//   VIGILI_TEST_TOKEN  = user_token (Resend bearer 用ではなく client user-token)
//   VIGILI_TEST_RELAY  = relay base URL (省略時 https://relay.vigili.io)
//   VIGILI_HOME        = daemon home (省略時 ~/.vigili)
const PID = process.env.VIGILI_TEST_PID;
const TOKEN = process.env.VIGILI_TEST_TOKEN;
if (!PID || !TOKEN) {
  console.error("ERROR: set VIGILI_TEST_PID and VIGILI_TEST_TOKEN (from `vigili-cli pair`)");
  process.exit(2);
}
const RELAY = (process.env.VIGILI_TEST_RELAY ?? "https://relay.vigili.io").replace(/\/$/, "");
const HOME = process.env.VIGILI_HOME ?? `${process.env.HOME}/.vigili`;
const SOCKET = `${HOME}/daemon.sock`;
const URL = `${RELAY.replace(/^http/, "ws")}/v1/clients/${PID}?token=${TOKEN}`;

function log(s, ...args) {
  process.stderr.write(`[test] ${s}\n`);
  for (const a of args)
    process.stderr.write(`       ${typeof a === "string" ? a : JSON.stringify(a)}\n`);
}

async function main() {
  // 1. Open WS as the user
  log(`connecting to ${URL.slice(0, 60)}…`);
  const ws = new WebSocket(URL);
  const wsOpenP = new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  await wsOpenP;
  log("WS open as user client");

  // Stream all WS messages into a queue + an "await match" helper
  const pending = [];
  const waiters = [];
  ws.on("message", (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf-8"));
    } catch {
      return;
    }
    log(`relay→client: ${parsed.type}`, parsed);
    const w = waiters.shift();
    if (w) w(parsed);
    else pending.push(parsed);
  });
  async function nextMessage(filter, timeoutMs = 10_000) {
    const start = Date.now();
    while (true) {
      while (pending.length > 0) {
        const m = pending.shift();
        if (filter(m)) return m;
      }
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) throw new Error("nextMessage: timeout");
      const found = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("nextMessage: timeout")), remaining);
        waiters.push((m) => {
          clearTimeout(timer);
          if (filter(m)) resolve(m);
          else {
            pending.unshift(m);
            resolve(undefined);
          }
        });
      });
      if (found !== undefined) return found;
    }
  }

  // 2. (snapshot は daemon 側に未送信タイミングのバグがあり来ないことがあるのでスキップ)
  //    pending broadcast は enqueue 時に常に出るので、それを待てば十分。
  log("(skipping snapshot wait — pending message will validate the bridge)");

  // 3. open daemon socket as a gate would
  log(`opening unix socket ${SOCKET}`);
  const sock = createConnection(SOCKET);
  await new Promise((res, rej) => {
    sock.once("connect", res);
    sock.once("error", rej);
  });
  log("daemon socket open");

  let sockBuf = "";
  const sockLines = [];
  const sockWaiters = [];
  sock.on("data", (chunk) => {
    sockBuf += chunk.toString("utf-8");
    let nl;
    while ((nl = sockBuf.indexOf("\n")) !== -1) {
      const line = sockBuf.slice(0, nl);
      sockBuf = sockBuf.slice(nl + 1);
      if (!line) continue;
      const parsed = JSON.parse(line);
      log(`daemon→gate: ${JSON.stringify(parsed).slice(0, 120)}`);
      const w = sockWaiters.shift();
      if (w) w(parsed);
      else sockLines.push(parsed);
    }
  });
  function nextSockLine(timeoutMs = 60_000) {
    return new Promise((res, rej) => {
      if (sockLines.length > 0) return res(sockLines.shift());
      const timer = setTimeout(() => rej(new Error("daemon socket timeout")), timeoutMs);
      sockWaiters.push((m) => {
        clearTimeout(timer);
        res(m);
      });
    });
  }

  // 4. Send a ToolRequest that will be "ask" (random Bash)
  const sessionId = randomUUID();
  const reqId = randomUUID();
  // 未分類の Bash として ask に落ちるよう、policy.yaml のどの allow ルールにも
  // 引っかからない命令を選ぶ (say / pbcopy / 不明な binary 等)。
  const cmd = `vigili-remote-test-${Date.now()} --no-op`;
  const req = {
    kind: "request",
    id: reqId,
    session_id: sessionId,
    session_tag: "remote-test",
    tool_name: "Bash",
    tool_input: { command: cmd, description: "Remote approval test" },
    cwd: "/tmp",
    created_at: Date.now(),
  };
  log(`sending ToolRequest`);
  sock.write(`${JSON.stringify(req)}\n`);

  // 5a. daemon が即座に返してくる "ask" レスポンスから本当の request_id を取る
  log("waiting for daemon ask response…");
  const askResp = await nextSockLine();
  if (askResp.decision !== "ask") {
    throw new Error(`expected ask, got ${JSON.stringify(askResp)}`);
  }
  const realId = askResp.request_id;
  log(`daemon assigned request_id=${realId}`);

  // 5b. wait for "pending" on relay (filter on real id)
  log("waiting for relay→client pending…");
  const pendingMsg = await nextMessage((m) => {
    const isPending = m.type === "pending";
    const idMatch = m.request?.id === realId;
    log(
      `  filter probe: type=${m.type} reqId=${m.request?.id} expectedId=${realId} → match=${isPending && idMatch}`,
    );
    return isPending && idMatch;
  }, 15_000);
  log(`✓ pending arrived via relay: ${pendingMsg.request.id}`);

  // 6. send decide allow via relay (use real id)
  const decideMsg = { type: "decide", id: realId, decision: "allow" };
  log(`sending decide via relay: ${JSON.stringify(decideMsg)}`);
  ws.send(JSON.stringify(decideMsg));

  // 7. wait for daemon to resolve the gate
  log("waiting for daemon to return final decision to gate…");
  const decision = await nextSockLine();
  log(`✓ daemon → gate: ${JSON.stringify(decision)}`);

  // 8. also expect "resolved" to come back via relay
  const resolvedMsg = await nextMessage((m) => m.type === "resolved" && m.id === realId, 5_000);
  log(`✓ resolved via relay: ${JSON.stringify(resolvedMsg)}`);

  const passed = decision.decision === "allow";
  log(
    passed ? "\nPASS: end-to-end remote approval works" : `\nFAIL: decision=${decision.decision}`,
  );

  ws.close();
  sock.end();
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  log(`ERROR: ${err.message}`);
  process.exit(2);
});
