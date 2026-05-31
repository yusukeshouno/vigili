/**
 * Small, dependency-free helpers shared across the runner.
 */

/** Narrow an unknown value to a plain object, or null. */
export function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/** Return a string field from a record, or null if absent / not a string. */
export function strField(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" ? v : null;
}

/**
 * Produce a short, human-readable one-liner describing a tool input.
 * Prefers well-known keys (command, file_path, ...) and otherwise falls back
 * to a clipped JSON dump.
 */
export function summarizeInput(input: unknown, max = 80): string {
  const rec = asRecord(input);
  if (rec) {
    for (const key of ["command", "file_path", "path", "pattern", "url", "description"]) {
      const v = rec[key];
      if (typeof v === "string" && v.length > 0) {
        return clip(v, max);
      }
    }
  }
  try {
    return clip(JSON.stringify(input), max);
  } catch {
    return "<unserializable input>";
  }
}

/** Clip a string to `max` chars, appending an ellipsis when truncated. */
export function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) {
    return flat;
  }
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}
