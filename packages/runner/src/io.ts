import { type Interface, createInterface } from "node:readline";

/**
 * Thin wrapper over readline so the rest of the runner can prompt the local
 * terminal without caring about stream wiring. In P1 this is the seam where a
 * remote (daemon-driven) Io implementation will slot in.
 */
export interface Io {
  /** Prompt the user and resolve with the trimmed line they type. */
  ask(prompt: string): Promise<string>;
  /** Release the underlying readline interface. */
  close(): void;
}

export function createIo(): Io {
  let rl: Interface | null = null;

  const ensure = (): Interface => {
    if (rl === null) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
    }
    return rl;
  };

  return {
    ask(prompt: string): Promise<string> {
      const iface = ensure();
      return new Promise<string>((resolve) => {
        iface.question(prompt, (answer) => {
          resolve(answer.trim());
        });
      });
    },
    close(): void {
      if (rl !== null) {
        rl.close();
        rl = null;
      }
    },
  };
}

/**
 * Ask a yes/no question. Empty input returns `fallback`.
 */
export async function askYesNo(io: Io, prompt: string, fallback = false): Promise<boolean> {
  const hint = fallback ? "[Y/n]" : "[y/N]";
  const answer = (await io.ask(`${prompt} ${hint} `)).toLowerCase();
  if (answer === "") {
    return fallback;
  }
  return answer === "y" || answer === "yes";
}

/**
 * Ask the user to pick one of `count` options (presented 1-based).
 * Returns a 0-based index, or null if the input was empty / out of range.
 */
export async function askChoice(io: Io, prompt: string, count: number): Promise<number | null> {
  const raw = await io.ask(prompt);
  if (raw === "") {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) {
    return null;
  }
  return n - 1;
}
