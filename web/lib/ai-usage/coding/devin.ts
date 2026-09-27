import os from "node:os";
import path from "node:path";

import type { RawReq } from "./scan";

/**
 * Devin for Terminal's requests, from its own session database.
 *
 * Every model reply is a row in `message_nodes` whose message metadata carries
 * the request id, the generating model and the token counts (input is the
 * uncached part; cache reads and writes are separate, Anthropic-style). One
 * reply can span several rows — thinking, text, tool calls — each repeating
 * the same metrics, so rows are folded by request id and counted once.
 *
 * Rows only grow, so a scan reads past the last row it saw, with an overlap in
 * case a recent row's metrics were written after it was inserted.
 */

export const DEVIN_DB = path.join(os.homedir(), ".local", "share", "devin", "cli", "sessions.db");

/** Re-read this many rows behind the last one seen. */
export const DEVIN_OVERLAP = 500;

export function devinSql(afterRow: number): string {
  const meta = (field: string) => `json_extract(m.chat_message, '$.metadata.${field}')`;
  return `select coalesce(${meta("request_id")}, m.session_id || ':' || m.node_id) as id,
      min(${meta("created_at")}) as createdAt, min(m.created_at) as nodeAt,
      max(${meta("generation_model")}) as model,
      max(${meta("metrics.input_tokens")}) as input, max(${meta("metrics.output_tokens")}) as output,
      max(${meta("metrics.cache_read_tokens")}) as cacheRead, max(${meta("metrics.cache_creation_tokens")}) as cacheWrite,
      max(s.working_directory) as cwd, max(m.row_id) as rowId
    from message_nodes m join sessions s on s.id = m.session_id
    where m.row_id > ${Math.max(0, Math.floor(afterRow))}
      and json_valid(m.chat_message)
      and json_extract(m.chat_message, '$.role') = 'assistant'
      and ${meta("metrics")} is not null
    group by 1`;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One request per row from `devinSql`; replies with no tokens at all are dropped. */
export function devinReqs(rows: Record<string, unknown>[]): RawReq[] {
  const out: RawReq[] = [];
  for (const r of rows) {
    const input = num(r.input);
    const output = num(r.output);
    const cacheRead = num(r.cacheRead);
    const cacheWrite = num(r.cacheWrite);
    if (input + output + cacheRead + cacheWrite === 0) continue;
    const iso = typeof r.createdAt === "string" ? Date.parse(r.createdAt) : NaN;
    out.push([
      String(r.id),
      Number.isFinite(iso) ? iso : num(r.nodeAt) * 1000,
      typeof r.model === "string" && r.model ? r.model : "unknown",
      input,
      output,
      cacheRead,
      cacheWrite,
      0,
      0,
      0,
      typeof r.cwd === "string" ? r.cwd : null,
    ]);
  }
  return out;
}
