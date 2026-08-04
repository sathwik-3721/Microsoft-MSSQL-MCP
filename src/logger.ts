function timestamp(): string {
  return new Date().toISOString();
}

// ── Core write ────────────────────────────────────────────────────────────────
function write(line: string) {
  process.stderr.write(`${line}\n`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Call this just before a tool's run() is invoked. */
export function logToolCall(toolName: string, args: unknown): void {
  const safeArgs = sanitizeArgs(args);
  write(
    `[${timestamp()}] CALL  tool=${toolName} args=${JSON.stringify(safeArgs)}`
  );
}

/** Call this after a tool's run() returns successfully. */
export function logToolSuccess(
  toolName: string,
  durationMs: number,
  result: unknown
): void {
  const summary = summarise(result);
  write(
    `[${timestamp()}] OK    tool=${toolName} duration=${durationMs}ms result=${summary}`
  );
}

/** Call this if a tool's run() throws. */
export function logToolError(
  toolName: string,
  durationMs: number,
  error: unknown
): void {
  const msg = error instanceof Error ? error.message : String(error);
  write(
    `[${timestamp()}] ERROR tool=${toolName} duration=${durationMs}ms error=${msg}`
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip values for keys that look like secrets before logging args. */
function sanitizeArgs(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const SENSITIVE = /password|secret|token|key|credential/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "***" : v;
  }
  return out;
}

/** Produce a short summary string from a tool result object. */
function summarise(result: unknown): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  const parts: string[] = [];

  if ("success" in r) parts.push(`success=${r.success}`);
  if ("message" in r) parts.push(`message="${r.message}"`);

  // list_table → items: [{ "": "dbo.agent_messages" }, ...]
  if ("items" in r && Array.isArray(r.items)) {
    const names = (r.items as Record<string, unknown>[])
      .map((row) => Object.values(row)[0])
      .filter(Boolean)
      .join(", ");
    parts.push(`tables(${r.items.length})=[${names}]`);
  }

  // describe_table → columns: [{ name, type }, ...] or schema_discovery → columns: [{ column_name, column_type }, ...]
  if ("columns" in r && Array.isArray(r.columns)) {
    const totalCols = r.columns.length;
    const formatted = (r.columns as Record<string, unknown>[]).slice(0, 5).map((c) => {
      const name = (c.name ?? c.column_name ?? "unknown") as string;
      const type = (c.type ?? c.column_type ?? "unknown") as string;
      return `${name}:${type}`;
    });
    const suffix = totalCols > 5 ? `, ... (${totalCols - 5} more)` : "";
    parts.push(`columns(${totalCols})=[${formatted.join(", ")}${suffix}]`);
  }

  // schema_discovery → relationships: [{ constraint_name, ... }, ...]
  if ("relationships" in r && Array.isArray(r.relationships)) {
    parts.push(`relationships(${r.relationships.length})`);
  }

  // insert/update/delete → rowsAffected
  if ("rowsAffected" in r) parts.push(`rowsAffected=${r.rowsAffected}`);

  // read_data → rows array
  if ("rows" in r && Array.isArray(r.rows)) parts.push(`rows=${r.rows.length}`);

  return parts.length ? parts.join(" ") : JSON.stringify(result).slice(0, 120);
}
