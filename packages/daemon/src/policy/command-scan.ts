/**
 * シェルコマンド文字列を「実際に実行されるシンプルコマンド」単位の
 * セグメントに分割する軽量スキャナ。
 *
 * 目的: invariant (rm -rf / 等) の照合を「コマンド位置」に限定し、
 * コミットメッセージのヒアドキュメント・echo の文字列リテラル・
 * コメント内に危険パターンが書かれているだけの誤検知を防ぐ。
 *
 * 安全側の方針 (迷ったらブロックを維持する側に倒す):
 *   - `$(...)` / バッククォートの中身は実行されるので別セグメントとして走査
 *   - 二重引用符内の `$(...)` も実行されるので走査 (以降のクォート状態は
 *     厳密に追跡せず、コード扱いに倒す = 過剰ブロック側)
 *   - 引用符付きデリミタのヒアドキュメント (<<'EOF') は完全リテラルなので除外、
 *     引用符なし (<<EOF) は本文中の `$(...)` / バッククォートだけ走査
 *   - 未終端ヒアドキュメントは本文をコード扱いして走査 (ブロック側)
 *   - sudo/env/xargs 等の wrapper 越し・`bash -c "..."`・eval は中身を走査
 */

const MAX_DEPTH = 5;

/** sudo 等、後続を実コマンドとして実行する wrapper。 */
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "builtin",
  "exec",
  "nohup",
  "nice",
  "ionice",
  "time",
  "timeout",
  "xargs",
]);

/** 引数文字列をシェルコードとして解釈するコマンド。 */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "eval"]);

export interface CommandSegment {
  /** セグメントの生テキスト (引用符は保持)。 */
  readonly text: string;
  /** このセグメントで実行されると解釈したコマンド名 (basename, 小文字)。 */
  readonly names: ReadonlySet<string>;
  /** 引用符の外に現れたトークン (小文字)。サブコマンド判定用。 */
  readonly bareTokens: ReadonlySet<string>;
  /** xargs 経由 (削除対象が stdin から来るため target はセグメント外にある)。 */
  readonly viaXargs: boolean;
}

const HEREDOC_OPEN = /^<<(?!<)(-?)\s*(\\?)(['"]?)([A-Za-z0-9_]+)\3/u;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/u;

function isWordBreakBefore(buf: string): boolean {
  return buf.length === 0 || /\s/u.test(buf[buf.length - 1] ?? "");
}

/**
 * 文字列をコード位置のセグメントに分割する。
 * 単一引用符内は完全リテラル。二重引用符内は `$(` / バッククォートのみ
 * コード扱い。コメント (#〜行末) とヒアドキュメント本文は除外する。
 */
export function splitExecutableSegments(src: string, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [src];
  const segments: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let pendingHeredocs: { delim: string; quoted: boolean; stripTabs: boolean }[] = [];

  const flush = (): void => {
    const t = buf.trim();
    if (t.length > 0) segments.push(t);
    buf = "";
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;

    if (inSingle) {
      buf += c;
      if (c === "'") inSingle = false;
      i += 1;
      continue;
    }

    if (inDouble) {
      if (c === "\\" && i + 1 < src.length) {
        buf += c + src[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') {
        inDouble = false;
        buf += c;
        i += 1;
        continue;
      }
      // 二重引用符内でもコマンド置換は実行される。安全側: 以降をコード扱い。
      if ((c === "$" && src[i + 1] === "(") || c === "`") {
        inDouble = false;
        flush();
        i += c === "`" ? 1 : 2;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }

    // ─── 引用符外 (コード位置) ───
    if (c === "\\") {
      buf += c + (src[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === "#" && isWordBreakBefore(buf)) {
      // コメント: 行末まで読み飛ばす (改行自体は flush 処理に回す)
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    const heredoc = HEREDOC_OPEN.exec(src.slice(i));
    if (heredoc) {
      const [matched, dash, backslash, quote, delim] = heredoc;
      pendingHeredocs.push({
        delim: delim as string,
        quoted: quote !== "" || backslash !== "",
        stripTabs: dash === "-",
      });
      i += matched.length;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      flush();
      i += 2;
      continue;
    }
    if (c === "`" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      flush();
      i += 1;
      continue;
    }
    if (c === "\n") {
      flush();
      i += 1;
      if (pendingHeredocs.length > 0) {
        i = consumeHeredocBodies(src, i, pendingHeredocs, segments, depth);
        pendingHeredocs = [];
      }
      continue;
    }
    buf += c;
    i += 1;
  }
  flush();
  return segments;
}

/**
 * ヒアドキュメント本文を読み飛ばす。引用符なしデリミタの場合は本文中の
 * コマンド置換だけを走査対象として segments に追加する。
 * デリミタが見つからない (未終端) 場合は安全側に倒し、残り全体を
 * コードとして走査する。返り値は次に読む位置。
 */
function consumeHeredocBodies(
  src: string,
  start: number,
  heredocs: { delim: string; quoted: boolean; stripTabs: boolean }[],
  segments: string[],
  depth: number,
): number {
  let i = start;
  for (const h of heredocs) {
    const bodyStart = i;
    let found = false;
    while (i <= src.length) {
      const lineEnd = src.indexOf("\n", i);
      const line = lineEnd === -1 ? src.slice(i) : src.slice(i, lineEnd);
      const candidate = h.stripTabs ? line.replace(/^\t+/u, "") : line;
      const next = lineEnd === -1 ? src.length : lineEnd + 1;
      if (candidate === h.delim) {
        const body = src.slice(bodyStart, i);
        if (!h.quoted) {
          segments.push(...extractSubstitutions(body, depth));
        }
        i = next;
        found = true;
        break;
      }
      if (lineEnd === -1) break;
      i = next;
    }
    if (!found) {
      // 未終端: 本文かコードか判別不能。安全側 = コードとして走査。
      segments.push(...splitExecutableSegments(src.slice(bodyStart), depth + 1));
      return src.length;
    }
  }
  return i;
}

/** テキスト中の `$(...)` / バッククォートの中身をセグメント化して返す。 */
function extractSubstitutions(text: string, depth: number): string[] {
  const out: string[] = [];
  const re = /\$\(([^)]*)\)|`([^`]*)`/gu;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const inner = m[1] ?? m[2] ?? "";
    out.push(...splitExecutableSegments(inner, depth + 1));
    m = re.exec(text);
  }
  return out;
}

interface Token {
  value: string; // 引用符を剥がした値
  raw: string;
  quoted: boolean;
}

/** セグメントを空白でトークン化 (引用符を尊重)。 */
function tokenizeSegment(segment: string): Token[] {
  const tokens: Token[] = [];
  let value = "";
  let raw = "";
  let quoted = false;
  let i = 0;
  const push = (): void => {
    if (raw.length > 0) tokens.push({ value, raw, quoted });
    value = "";
    raw = "";
    quoted = false;
  };
  while (i < segment.length) {
    const c = segment[i] as string;
    if (/\s/u.test(c)) {
      push();
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      quoted = true;
      raw += c;
      const close = segment.indexOf(c, i + 1);
      if (close === -1) {
        value += segment.slice(i + 1);
        raw += segment.slice(i + 1);
        i = segment.length;
      } else {
        value += segment.slice(i + 1, close);
        raw += segment.slice(i + 1, close + 1);
        i = close + 1;
      }
      continue;
    }
    if (c === "\\" && i + 1 < segment.length) {
      value += segment[i + 1];
      raw += c + segment[i + 1];
      i += 2;
      continue;
    }
    value += c;
    raw += c;
    i += 1;
  }
  push();
  return tokens;
}

function baseName(word: string): string {
  const slash = word.lastIndexOf("/");
  return (slash === -1 ? word : word.slice(slash + 1)).toLowerCase();
}

/**
 * コマンド文字列全体を解析し、実行されるセグメント一覧を返す。
 * `bash -c "..."` / eval の引数はシェルコードとして再帰的に展開する。
 */
export function scanCommand(command: string, depth = 0): CommandSegment[] {
  const out: CommandSegment[] = [];
  for (const text of splitExecutableSegments(command, depth)) {
    const tokens = tokenizeSegment(text);
    const names = new Set<string>();
    const bareTokens = new Set<string>();
    for (const tok of tokens) {
      if (!tok.quoted) bareTokens.add(tok.value.toLowerCase());
    }
    let viaXargs = false;
    let sawWrapper = false;
    let resolved = false;
    let isShellCmd = false;

    for (const tok of tokens) {
      const base = baseName(tok.value);
      if (!resolved) {
        if (!tok.quoted && ENV_ASSIGN.test(tok.value)) continue;
        if (WRAPPERS.has(base)) {
          sawWrapper = true;
          if (base === "xargs") viaXargs = true;
          continue;
        }
        if (sawWrapper && tok.value.startsWith("-")) continue;
        names.add(base);
        if (SHELLS.has(base)) isShellCmd = true;
        resolved = true;
        continue;
      }
      // wrapper 経由はフラグ引数 (sudo -u alice rm ...) の解釈が曖昧。
      // 安全側: 後続の bare token も候補に含める。
      if (sawWrapper && !tok.quoted && (base === "rm" || base === "git")) {
        names.add(base);
      }
    }

    out.push({ text, names, bareTokens, viaXargs });

    // bash -c "..." / eval '...' : 引用符付き引数をシェルコードとして再帰走査
    if (isShellCmd && depth < MAX_DEPTH) {
      for (const tok of tokens.slice(1)) {
        if (tok.quoted && tok.value.length > 0) {
          out.push(...scanCommand(tok.value, depth + 1));
        }
      }
    }
  }
  return out;
}
