import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigLoadError, loadConfigFile } from "./config.js";

function tmp(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-cfg-"));
  const p = join(dir, "config.yaml");
  writeFileSync(p, yaml, "utf-8");
  return p;
}

describe("loadConfigFile", () => {
  it("returns defaults when file is missing", async () => {
    const cfg = await loadConfigFile("/nonexistent/sentinel/config.yaml");
    expect(cfg.daemon.ws_port).toBe(7878);
    expect(cfg.daemon.ws_host).toBe("0.0.0.0");
    expect(cfg.ntfy).toBeUndefined();
    expect(cfg.session_tags).toEqual({});
  });

  it("parses full config", async () => {
    const p = tmp(`daemon:
  ws_port: 9000
  ws_host: 0.0.0.0
ntfy:
  server: https://ntfy.example
  topic: sentinel-yusuke-abc
  priority_map:
    normal: 2
    critical: 4
session_tags:
  neort-wiki: "Neort Wiki"
  diptych: Diptych
`);
    const cfg = await loadConfigFile(p);
    expect(cfg.daemon.ws_port).toBe(9000);
    expect(cfg.ntfy?.server).toBe("https://ntfy.example");
    expect(cfg.ntfy?.topic).toBe("sentinel-yusuke-abc");
    expect(cfg.ntfy?.priority_map).toEqual({ normal: 2, critical: 4 });
    expect(cfg.session_tags["neort-wiki"]).toBe("Neort Wiki");
  });

  it("rejects bad schema", async () => {
    const p = tmp(`ntfy:
  server: not-a-url
  topic: ""
`);
    await expect(loadConfigFile(p)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it("rejects priority out of range", async () => {
    const p = tmp(`ntfy:
  server: https://ntfy.sh
  topic: x
  priority_map:
    normal: 0
    critical: 10
`);
    await expect(loadConfigFile(p)).rejects.toBeInstanceOf(ConfigLoadError);
  });
});
