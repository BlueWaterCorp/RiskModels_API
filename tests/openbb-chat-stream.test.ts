import { describe, expect, it } from "vitest";
import {
  StreamingDeLatex,
  parseSseEvents,
  translateChatStream,
  type UpstreamChatEvent,
} from "@/app/openbb/_lib/chat-stream";
import { deLatex } from "@/app/openbb/_lib/delatex";

/** Run a full string through the streaming transformer in fixed-size chunks. */
function streamed(text: string, chunkSize: number): string {
  const dl = new StreamingDeLatex();
  let out = "";
  for (let i = 0; i < text.length; i += chunkSize) {
    out += dl.push(text.slice(i, i + chunkSize));
  }
  return out + dl.flush();
}

const CHUNK_SIZES = [1, 2, 3, 5, 7, 11, 1000];

describe("StreamingDeLatex", () => {
  // The blocking path applies deLatex to the whole answer; the streaming path
  // must produce the same text no matter how the provider splits the deltas.
  const CORPUS = [
    "$$\\text{Cost of Equity} = R_f + \\beta \\times \\text{ERP}$$",
    "where $R_{f}$ is the rate and $\\beta$ is sensitivity",
    "buybacks of $12.29B versus dividends of $3.82B",
    "EP of $146.3 billion and equity of $60B",
    "$$\\frac{E}{D+E} \\cdot R_e$$",
    "$\\gamma_{t}$",
    "\\[R_d \\times (1-T)\\]",
    "\\(R_e\\)",
    "Cost of equity:\n\n$$R_f + \\beta \\times ERP$$\n\nwhere $\\beta$ is levered.",
    "plain text with no math at all, just words and numbers 42",
  ];

  it("matches whole-string deLatex for every chunking of the corpus", () => {
    for (const text of CORPUS) {
      const expected = deLatex(text);
      for (const size of CHUNK_SIZES) {
        expect(streamed(text, size), `text=${JSON.stringify(text)} size=${size}`).toBe(
          expected,
        );
      }
    }
  });

  it("handles a $$ block split across deltas", () => {
    const dl = new StreamingDeLatex();
    let out = dl.push("The formula $$\\bet");
    out += dl.push("a \\times ERP$$ holds.");
    out += dl.flush();
    expect(out).toBe("The formula `β × ERP` holds.");
  });

  it("handles inline math split across deltas", () => {
    const dl = new StreamingDeLatex();
    let out = dl.push("where $R_");
    out += dl.push("{f}$ is the rate");
    out += dl.flush();
    expect(out).toBe("where R_f is the rate");
  });

  it("handles a \\command split across deltas inside a block", () => {
    const dl = new StreamingDeLatex();
    let out = dl.push("$$\\ti");
    out += dl.push("mes 2$$");
    out += dl.flush();
    expect(out).toBe(deLatex("$$\\times 2$$"));
  });

  it("emits plain text incrementally, before flush", () => {
    const dl = new StreamingDeLatex();
    const out = dl.push("Hello world, this is a long plain sentence ");
    expect(out).toBe("Hello world, this is a long plain sentence ");
    expect(dl.flush()).toBe("");
  });

  it("holds an open $$ block until it closes, then emits it converted", () => {
    const dl = new StreamingDeLatex();
    expect(dl.push("Result: $$\\beta")).toBe("Result: ");
    expect(dl.push(" + 1")).toBe("");
    const out = dl.push("$$ done ");
    expect(out).toBe("`β + 1` done ");
  });

  it("does not let a lone dollar amount stall the stream forever", () => {
    const dl = new StreamingDeLatex();
    let out = dl.push("costs $5 ");
    // Inline math needs a closer within 120 chars — after that the '$' is
    // released as plain text at the next whitespace boundary.
    out += dl.push("word ".repeat(30));
    expect(out.length).toBeGreaterThan(0);
    out += dl.flush();
    const full = "costs $5 " + "word ".repeat(30);
    expect(out).toBe(deLatex(full));
  });

  it("flushes an unterminated math region as-is at final", () => {
    const dl = new StreamingDeLatex();
    expect(dl.push("truncated $$\\beta +")).toBe("truncated ");
    expect(dl.flush()).toBe(deLatex("$$\\beta +"));
  });
});

/* ------------------------------------------------------------------ */
/* SSE parsing + event translation                                      */
/* ------------------------------------------------------------------ */

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function byteStream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<UpstreamChatEvent[]> {
  const out: UpstreamChatEvent[] = [];
  for await (const ev of parseSseEvents(stream)) out.push(ev);
  return out;
}

describe("parseSseEvents", () => {
  const wire =
    sseFrame("status", { round: 0, message: "Analyzing request" }) +
    ": keepalive comment\n\n" +
    sseFrame("delta", { text: "hello " }) +
    sseFrame("final", { content: "hello world", usage: { total_tokens: 3 } });

  it("parses frames regardless of byte-chunk boundaries", async () => {
    for (const size of [1, 3, 7, 4096]) {
      const events = await collect(byteStream(wire, size));
      expect(events.map((e) => e.type)).toEqual(["status", "delta", "final"]);
      expect(events[0].message).toBe("Analyzing request");
      expect(events[1].text).toBe("hello ");
      expect(events[2].content).toBe("hello world");
    }
  });

  it("skips malformed data frames instead of throwing", async () => {
    const events = await collect(
      byteStream("event: delta\ndata: {not json\n\n" + sseFrame("delta", { text: "x " }), 5),
    );
    expect(events.map((e) => e.type)).toEqual(["delta"]);
  });
});

describe("translateChatStream", () => {
  const TOOL_LABELS = { get_risk_metrics: "risk metrics" };

  type Frame = { event: string; data: unknown };

  async function run(wire: string) {
    const frames: Frame[] = [];
    let heartbeats = 0;
    const result = await translateChatStream({
      events: parseSseEvents(byteStream(wire, 9)),
      send: (event, data) => frames.push({ event, data }),
      toolLabels: TOOL_LABELS,
      onEvent: () => {
        heartbeats += 1;
      },
    });
    const text = frames
      .filter((f) => f.event === "copilotMessageChunk")
      .map((f) => (f.data as { delta: string }).delta)
      .join("");
    const statuses = frames
      .filter((f) => f.event === "copilotStatusUpdate")
      .map((f) => (f.data as { message: string }).message);
    return { frames, text, statuses, result, heartbeats };
  }

  it("translates status/tool/delta/final into copilot frames with real tokens", async () => {
    const answer = "AAPL cost of equity is $$R_f + \\beta \\times ERP$$ per CAPM.";
    const costLine = "\n\n---\n**API tool costs:** $0.0100 (1 tool call)";
    const wire =
      sseFrame("status", { round: 0, message: "Analyzing request" }) +
      sseFrame("status", { round: 0, message: "Running get_risk_metrics" }) +
      sseFrame("tool", { name: "get_risk_metrics", latency_ms: 420 }) +
      sseFrame("tool", { name: "get_risk_metrics", latency_ms: 100 }) + // dedup
      sseFrame("tool", { name: "get_unknown_tool", latency_ms: 5 }) + // raw-name fallback
      sseFrame("status", { round: 1, message: "Composing response" }) +
      sseFrame("delta", { text: "AAPL cost of equity is " }) +
      sseFrame("delta", { text: "$$R_f + \\beta \\times" }) +
      sseFrame("delta", { text: " ERP$$ per CAPM." }) +
      sseFrame("final", {
        content: answer + costLine,
        tool_calls_summary: [],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        quota: null,
        persisted_id: null,
      });

    const { text, statuses, result, heartbeats } = await run(wire);

    expect(statuses).toEqual([
      "Analyzing request",
      "Running get_risk_metrics",
      "Consulted: risk metrics",
      "Consulted: get_unknown_tool",
      "Composing response",
    ]);
    // Streamed tokens + the final-only cost-line suffix, deLatex'd — identical
    // to what the blocking path would have rendered from final.content.
    expect(text).toBe(deLatex(answer + costLine));
    expect(result).toEqual({
      sawFinal: true,
      errored: false,
      errorMessage: null,
      streamedText: true,
    });
    expect(heartbeats).toBeGreaterThanOrEqual(10);
  });

  it("emits final.content whole when no deltas arrived", async () => {
    const wire =
      sseFrame("status", { round: 0, message: "Analyzing request" }) +
      sseFrame("final", {
        content: "Answer with $\\beta$ inline.",
        tool_calls_summary: null,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        quota: null,
        persisted_id: null,
      });
    const { text, result } = await run(wire);
    expect(text).toBe("Answer with β inline.");
    expect(result.sawFinal).toBe(true);
    expect(result.streamedText).toBe(true);
  });

  it("reports terminal error events without emitting error text itself", async () => {
    const wire =
      sseFrame("delta", { text: "partial answer " }) +
      sseFrame("error", { status: 502, message: "upstream exploded" });
    const { text, result } = await run(wire);
    expect(text).toBe("partial answer ");
    expect(result).toEqual({
      sawFinal: false,
      errored: true,
      errorMessage: "upstream exploded",
      streamedText: true,
    });
  });

  it("flushes buffered text when the stream drops before final", async () => {
    const wire =
      sseFrame("delta", { text: "the answer is $$\\beta" }) +
      sseFrame("delta", { text: " + 1$$" });
    const { text, result } = await run(wire);
    expect(text).toBe("the answer is `β + 1`");
    expect(result.sawFinal).toBe(false);
    expect(result.errored).toBe(false);
  });

  it("ignores unknown event types (additive vocabulary)", async () => {
    const wire =
      sseFrame("telemetry", { anything: true }) +
      sseFrame("delta", { text: "hello world " }) +
      sseFrame("final", {
        content: "hello world",
        tool_calls_summary: null,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        quota: null,
        persisted_id: null,
      });
    const { text, result } = await run(wire);
    expect(text).toBe("hello world ");
    expect(result.sawFinal).toBe(true);
  });
});
