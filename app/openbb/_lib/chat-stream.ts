/**
 * Streaming glue for the OpenBB adapter (G.23 P1).
 *
 * `POST /api/chat` streams its ChatStreamEvent vocabulary as SSE when called
 * with `Accept: text/event-stream` (see lib/chat/stream-events.ts — consumers
 * must ignore unknown event types / fields). This module:
 *
 *  - parses that SSE byte stream back into events (`parseSseEvents`),
 *  - applies deLatex incrementally on token deltas (`StreamingDeLatex`), and
 *  - translates engine events into OpenBB copilot frames
 *    (`translateChatStream`): status/tool → copilotStatusUpdate,
 *    delta → copilotMessageChunk, final → tail flush + authoritative-suffix
 *    emission (the engine appends a tool-cost line to `final.content` that
 *    never appears in deltas).
 */
import { deLatex } from "./delatex";

/* ------------------------------------------------------------------ */
/* Streaming deLatex                                                    */
/* ------------------------------------------------------------------ */

// Mirror the bounds in delatex.ts: inline $...$ / \(...\) inner ≤ 120 chars
// (no newline), display $$...$$ / \[...\] inner ≤ 300 chars.
const INLINE_MAX = 120;
const BLOCK_MAX = 300;

/**
 * Largest prefix of `buf` that is safe to run through `deLatex` now: it ends
 * at a whitespace boundary in plain text (never a partial word or command)
 * and never splits a completed — or still-completable — math region.
 * Openers whose region can no longer match deLatex's bounded patterns
 * (e.g. a lone `$5` price once 120+ chars pass without a closer) are
 * released as plain text so a dollar amount can't stall the stream forever.
 */
function safeCut(buf: string): number {
  let i = 0;
  let cut = 0;
  while (i < buf.length) {
    const c = buf[i];
    if (c === "$") {
      if (buf[i + 1] === "$") {
        const close = buf.indexOf("$$", i + 2);
        if (close !== -1) {
          i = close + 2;
          continue;
        }
        if (buf.length - (i + 2) > BLOCK_MAX + 2) {
          i += 2; // inner already too long to ever match — plain text
          continue;
        }
        return cut; // unclosed display block — hold from the opener
      }
      const rest = buf.slice(i + 1);
      const stop = rest.search(/[$\n]/);
      if (stop === -1) {
        if (rest.length > INLINE_MAX) {
          i += 1; // closer can no longer arrive in range — plain '$'
          continue;
        }
        return cut; // may still become inline math — hold
      }
      if (rest[stop] === "$" && stop >= 1 && stop <= INLINE_MAX) {
        i += 1 + stop + 1; // completed inline region — skip it whole
        continue;
      }
      i += 1; // newline first, or closer out of range — plain '$'
      continue;
    }
    if (c === "\\") {
      const next = buf[i + 1];
      if (next === undefined) return cut; // could become \[ or \(
      if (next === "[") {
        const close = buf.indexOf("\\]", i + 2);
        if (close !== -1) {
          i = close + 2;
          continue;
        }
        if (buf.length - (i + 2) > BLOCK_MAX + 2) {
          i += 2;
          continue;
        }
        return cut;
      }
      if (next === "(") {
        const rest = buf.slice(i + 2);
        const stop = rest.search(/[)\n]/);
        if (stop === -1) {
          if (rest.length > INLINE_MAX + 1) {
            i += 2;
            continue;
          }
          return cut;
        }
        if (
          rest[stop] === ")" &&
          rest[stop - 1] === "\\" &&
          stop - 1 >= 1 &&
          stop - 1 <= INLINE_MAX
        ) {
          i += 2 + stop + 1; // completed \(...\) region
          continue;
        }
        i += 2; // first ')' isn't a '\)' closer — can never match
        continue;
      }
      i += 1; // bare command/escape — plain outside math regions
      continue;
    }
    if (/\s/.test(c)) cut = i + 1;
    i += 1;
  }
  return cut;
}

/**
 * Stateful per-delta deLatex: feed provider token deltas via `push` (returns
 * text safe to emit now, possibly ""), then `flush` the remainder at final.
 * Buffers until whitespace so words/commands are never split, and holds
 * open math regions ($$…$$, $…$, \[…\], \(…\)) until they close.
 */
export class StreamingDeLatex {
  private buf = "";

  push(text: string): string {
    this.buf += text;
    const cut = safeCut(this.buf);
    if (cut === 0) return "";
    const out = deLatex(this.buf.slice(0, cut));
    this.buf = this.buf.slice(cut);
    return out;
  }

  flush(): string {
    if (!this.buf) return "";
    const out = deLatex(this.buf);
    this.buf = "";
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* SSE parsing                                                          */
/* ------------------------------------------------------------------ */

/** One upstream ChatStreamEvent, loosely typed (unknown fields ignored). */
export type UpstreamChatEvent = { type: string } & Record<string, unknown>;

function parseFrame(frame: string): UpstreamChatEvent | null {
  let type = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // SSE comment / keepalive
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  try {
    const payload: unknown = JSON.parse(dataLines.join("\n"));
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return { ...(payload as Record<string, unknown>), type };
    }
    return { type };
  } catch {
    return null; // malformed frame — skip (additive/forward-compatible)
  }
}

/** Parse an SSE byte stream (as emitted by /api/chat) into upstream events. */
export async function* parseSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<UpstreamChatEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const evt = parseFrame(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (evt) yield evt;
      }
    }
    buf += decoder.decode();
    const tail = parseFrame(buf);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Event translation                                                    */
/* ------------------------------------------------------------------ */

export interface TranslateResult {
  /** Engine emitted `final` (stream completed normally). */
  sawFinal: boolean;
  /** Engine emitted a terminal `error` event. */
  errored: boolean;
  errorMessage: string | null;
  /** At least one copilotMessageChunk was sent. */
  streamedText: boolean;
}

/**
 * Translate upstream ChatStreamEvents into OpenBB copilot SSE frames.
 *
 *   status → copilotStatusUpdate (message as-is)
 *   tool   → copilotStatusUpdate "Consulted: <label>" (TOOL_LABELS, deduped)
 *   delta  → copilotMessageChunk (deLatex applied via StreamingDeLatex)
 *   final  → flush transformer tail; emit the authoritative suffix of
 *            final.content beyond the streamed deltas (the tool-cost line);
 *            if no deltas arrived at all, emit final.content whole
 *   error  → terminal; reported in the result (caller renders the message)
 *
 * Unknown event types are ignored (additive vocabulary). Citations and the
 * error copy are the caller's concern.
 */
export async function translateChatStream(opts: {
  events: AsyncIterable<UpstreamChatEvent>;
  send: (event: string, data: unknown) => void;
  toolLabels: Record<string, string>;
  /** Called on every upstream event — the caller stops its heartbeat here. */
  onEvent?: () => void;
}): Promise<TranslateResult> {
  const { events, send, toolLabels, onEvent } = opts;
  const dl = new StreamingDeLatex();
  const seenLabels = new Set<string>();
  let rawDeltas = "";
  let streamedText = false;
  let sawFinal = false;
  let errored = false;
  let errorMessage: string | null = null;

  const say = (delta: string) => {
    if (!delta) return;
    send("copilotMessageChunk", { delta });
    streamedText = true;
  };

  for await (const ev of events) {
    onEvent?.();
    if (ev.type === "status") {
      if (typeof ev.message === "string" && ev.message) {
        send("copilotStatusUpdate", {
          eventType: "INFO",
          message: ev.message,
          group: "reasoning",
          hidden: false,
        });
      }
    } else if (ev.type === "tool") {
      if (typeof ev.name === "string" && ev.name) {
        const label = toolLabels[ev.name] ?? ev.name;
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          send("copilotStatusUpdate", {
            eventType: "INFO",
            message: `Consulted: ${label}`,
            group: "reasoning",
            hidden: false,
          });
        }
      }
    } else if (ev.type === "delta") {
      if (typeof ev.text === "string" && ev.text) {
        rawDeltas += ev.text;
        say(dl.push(ev.text));
      }
    } else if (ev.type === "final") {
      sawFinal = true;
      say(dl.flush());
      const content = typeof ev.content === "string" ? ev.content : "";
      if (content.trim()) {
        const base = rawDeltas.trimEnd();
        if (!rawDeltas.trim()) {
          // No deltas at all (unusual) — final.content is all we have.
          say(deLatex(content));
        } else if (base && content.startsWith(base) && content.length > base.length) {
          // The route appends a tool-cost line to final.content that the
          // provider deltas never carried — emit just that suffix.
          say(deLatex(content.slice(base.length)));
        }
        // Otherwise final.content diverges from the streamed text in a way
        // we can't reconcile without duplicating — keep what was streamed.
      }
      break; // final is terminal
    } else if (ev.type === "error") {
      errored = true;
      errorMessage = typeof ev.message === "string" ? ev.message : null;
      break; // terminal — no final follows
    }
    // Unknown event types: ignore (vocabulary is additive).
  }

  if (!sawFinal && !errored) {
    // Upstream dropped mid-stream — flush whatever survived.
    say(dl.flush());
  }

  return { sawFinal, errored, errorMessage, streamedText };
}
