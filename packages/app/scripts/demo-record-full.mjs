/**
 * Self-contained demo recorder.
 * 1. Drains any stale pending items from the queue.
 * 2. Spawns simctl recordVideo, injects 3 demo cards, resolves them.
 * 3. Encodes the raw .mov to queue-loop.mp4 + queue-loop.webm.
 *
 * Run from the sentinel repo so the gate auto-allows it:
 *   node packages/app/scripts/demo-record-full.mjs
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { statSync } from "node:fs";

const SOCKET = `${process.env.HOME}/.vigili/daemon.sock`;
const SIM_ID = "151DCC8C-9181-46AD-B90E-56A3080C7FAB";
const BUNDLE  = "io.vigili.mobile.shono";
const RAW_MOV = "/tmp/demo-raw.mov";
const SCREENSHOTS = `/Users/shounoyusuke/Dropbox (個人)/sentinel/packages/landing/public/screenshots`;

const REQUESTS = [
  {
    tool_name: "Bash",
    tool_input: {
      command: "gh release create v1.2.0 --notes-file CHANGELOG.md --target main",
      description: "Cut a GitHub release",
    },
    session_tag: "billing-api",
  },
  {
    tool_name: "WebFetch",
    tool_input: {
      url: "https://api.openai.com/v1/chat/completions",
      prompt: "Summarize support ticket #4821",
    },
    session_tag: "support-bot",
  },
  {
    tool_name: "Bash",
    tool_input: {
      command: "aws s3 sync ./build/ s3://prod-static-assets-2026/ --delete",
      description: "Deploy to prod bucket",
    },
    session_tag: "frontend",
  },
];

function socketRequest(payload) {
  return new Promise((resolve, reject) => {
    const conn = createConnection(SOCKET);
    let buf = "";
    conn.on("connect", () => conn.write(`${JSON.stringify(payload)}\n`));
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      conn.end();
      try { resolve(JSON.parse(buf.slice(0, nl))); }
      catch (e) { reject(e); }
    });
    conn.on("error", reject);
  });
}

async function drainAllPending(log) {
  const resp = await socketRequest({ kind: "admin", action: "pending" });
  const ids = (resp.pending ?? []).map((r) => r.id);
  if (ids.length === 0) return;
  log(`Draining ${ids.length} stale item(s)…`);
  for (const id of ids) {
    await socketRequest({ kind: "admin", action: "resolve", id, decision: "deny" }).catch(() => {});
    await sleep(100);
  }
  await sleep(600);
}

function inject(req) {
  return new Promise((resolve, reject) => {
    const conn = createConnection(SOCKET);
    let buf = "";
    conn.on("connect", () => {
      conn.write(`${JSON.stringify({
        kind: "request",
        id: randomUUID(),
        session_id: randomUUID(),
        session_tag: req.session_tag,
        tool_name: req.tool_name,
        tool_input: req.tool_input,
        cwd: "/Users/dev/myproj",
        created_at: Date.now(),
      })}\n`);
    });
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const msg = JSON.parse(buf.slice(0, nl));
      if (msg.decision === "ask" && msg.request_id) {
        resolve({ assignedId: msg.request_id, conn });
      }
    });
    conn.on("error", reject);
  });
}

function adminResolve(id, decision) {
  return socketRequest({ kind: "admin", action: "resolve", id, decision });
}

function runCmd(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "inherit" });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}`))));
    p.on("error", reject);
  });
}

async function main() {
  const log = (msg) => console.error(`[demo] ${msg}`);

  log("Draining stale pending items…");
  await drainAllPending(log);

  log("Launching app on simulator…");
  await runCmd("xcrun", ["simctl", "launch", SIM_ID, BUNDLE]);
  await sleep(2500);

  log("Starting recording…");
  const recorder = spawn("xcrun", [
    "simctl", "io", SIM_ID, "recordVideo", "--codec=h264", "--force", RAW_MOV,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  recorder.on("error", (e) => log(`recorder error: ${e.message}`));
  await sleep(1500);

  log("Injecting 3 demo cards…");
  const handles = [];
  for (let i = 0; i < REQUESTS.length; i++) {
    const h = await inject(REQUESTS[i]);
    handles.push(h);
    log(`  card ${i + 1} injected (${h.assignedId.slice(0, 8)})`);
    if (i < REQUESTS.length - 1) await sleep(1200);
  }

  log("3 cards visible — holding 2.5s");
  await sleep(2500);

  log("Resolving all (allow)…");
  for (let i = 0; i < handles.length; i++) {
    await adminResolve(handles[i].assignedId, "allow");
    handles[i].conn.destroy();
    log(`  card ${i + 1} resolved`);
    if (i < handles.length - 1) await sleep(1000);
  }

  log("Queue empty — holding 2s");
  await sleep(2000);

  log("Stopping recording…");
  recorder.kill("SIGINT");
  await sleep(2500);

  log("Encoding mp4…");
  await runCmd("ffmpeg", [
    "-y", "-i", RAW_MOV,
    "-vf", "scale=390:-2:flags=lanczos",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-movflags", "faststart", "-an",
    `${SCREENSHOTS}/queue-loop.mp4`,
  ]);

  log("Encoding webm…");
  await runCmd("ffmpeg", [
    "-y", "-i", RAW_MOV,
    "-vf", "scale=390:-2:flags=lanczos",
    "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-an",
    `${SCREENSHOTS}/queue-loop.webm`,
  ]);

  const mp4 = (statSync(`${SCREENSHOTS}/queue-loop.mp4`).size / 1024).toFixed(0);
  const webm = (statSync(`${SCREENSHOTS}/queue-loop.webm`).size / 1024).toFixed(0);
  log(`Done! mp4: ${mp4}KB  webm: ${webm}KB`);
}

main().catch((e) => { console.error(`[demo] FATAL: ${e.message}`); process.exit(1); });
