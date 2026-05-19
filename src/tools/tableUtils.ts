/**
 * Shared table-name utilities used across all MCP tools.
 *
 * Handles every realistic format an LLM might pass:
 *   agent_messages
 *   dbo.agent_messages
 *   [dbo].[agent_messages]
 *   [agent_messages]
 *   Agent_Messages          (case-insensitive — SQL Server collation handles it)
 */

/** Parsed, clean parts of a table reference. */
export interface TableRef {
  schema: string | null;
  table: string;
}

/**
 * Strip T-SQL bracket quoting and split on the first dot.
 * e.g. "[dbo].[agent_messages]" → { schema: "dbo", table: "agent_messages" }
 */
export function parseTableName(input: string): TableRef {
  const cleaned = (input ?? "").trim().replace(/\[([^\]]+)\]/g, "$1");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return { schema: null, table: cleaned };
  return { schema: cleaned.slice(0, dot), table: cleaned.slice(dot + 1) };
}

/**
 * Return a safely bracket-quoted SQL table reference.
 * e.g. { schema: "dbo", table: "agent_messages" } → "[dbo].[agent_messages]"
 *      { schema: null,  table: "agent_messages" } → "[agent_messages]"
 */
export function quotedTable(ref: TableRef): string {
  return ref.schema
    ? `[${ref.schema}].[${ref.table}]`
    : `[${ref.table}]`;
}

/**
 * Convenience: parse and immediately return a quoted SQL reference.
 */
export function toSqlTable(input: string): string {
  return quotedTable(parseTableName(input));
}

/**
 * Validate that an identifier contains only safe characters.
 * Used for column names, index names, etc. that cannot be parameterized.
 */
export function isSafeIdentifier(name: string): boolean {
  return /^[\w]+$/.test(name); // letters, digits, underscore only
}
