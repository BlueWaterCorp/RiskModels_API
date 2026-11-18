import { describe, expect, it } from "vitest";
import {
  listSendGate,
  scheduledEditionState,
  type ListSendFlags,
  type SentLogState,
} from "@/lib/event-ledger-digest-schedule";

// Shapes of sent.json as scripts/event-ledger-digest.ts writes it. Only equality of the attachment
// sha matters here, so the two values are labels; the second address stands for a delivery inbox.
const SHA = "sha-of-todays-events";
const OTHER_SHA = "sha-of-earlier-events";
const RECIPIENTS = ["conrad@bwmacro.com", "team-inbox@example.com"];

const flags = (over: Partial<ListSendFlags> = {}): ListSendFlags => ({
  list: true,
  send: true,
  scheduled: false,
  confirmListSend: undefined,
  knowledgeWindow: false,
  sinceSeq: false,
  sample: false,
  ...over,
});

describe("list send gate", () => {
  it("keeps the manual gate: an ad-hoc list send needs the exact recipient count", () => {
    expect(listSendGate(flags(), 2)).toEqual({ ok: false, reason: "confirm_list_send_required" });
    expect(listSendGate(flags({ confirmListSend: "1" }), 2)).toEqual({ ok: false, reason: "confirm_list_send_required" });
    expect(listSendGate(flags({ confirmListSend: "2" }), 2)).toEqual({ ok: true });
  });

  it("lets the scheduled run send to every confirmed recipient without a count", () => {
    expect(listSendGate(flags({ scheduled: true }), 2)).toEqual({ ok: true });
    expect(listSendGate(flags({ scheduled: true }), 0)).toEqual({ ok: true });
  });

  it("refuses --scheduled outside a cursor-driven list send", () => {
    expect(listSendGate(flags({ scheduled: true, list: false }), 1)).toEqual({ ok: false, reason: "scheduled_needs_list" });
    expect(listSendGate(flags({ scheduled: true, send: false }), 1)).toEqual({ ok: false, reason: "scheduled_needs_send" });
    for (const over of [{ knowledgeWindow: true }, { sinceSeq: true }, { sample: true }]) {
      expect(listSendGate(flags({ scheduled: true, ...over }), 2)).toEqual({ ok: false, reason: "scheduled_cursor_only" });
    }
  });

  it("does not gate a dry run or a single-address run", () => {
    expect(listSendGate(flags({ send: false }), 2)).toEqual({ ok: true });
    expect(listSendGate(flags({ list: false }), 1)).toEqual({ ok: true });
  });
});

describe("scheduled edition state (one list edition per edition date)", () => {
  const log = (over: Partial<SentLogState>): SentLogState => ({
    attachment_sha256: SHA,
    sent: [],
    failed: [],
    complete: false,
    ...over,
  });

  it("is fresh when nothing was sent for the edition date", () => {
    expect(scheduledEditionState(null, SHA)).toBe("fresh");
    expect(scheduledEditionState(log({ attachment_sha256: OTHER_SHA }), SHA)).toBe("fresh");
  });

  it("resumes the same events: addresses already sent are skipped by the caller", () => {
    expect(scheduledEditionState(log({ sent: [{ to: RECIPIENTS[0], id: "re_1" }], failed: [RECIPIENTS[1]] }), SHA)).toBe(
      "resume",
    );
    expect(scheduledEditionState(log({ sent: RECIPIENTS.map((to, i) => ({ to, id: `re_${i}` })), complete: true }), SHA)).toBe(
      "complete",
    );
  });

  it("does not send a second edition for a date that already went out with other events", () => {
    const done = log({ attachment_sha256: OTHER_SHA, sent: RECIPIENTS.map((to, i) => ({ to, id: `re_${i}` })), complete: true });
    expect(scheduledEditionState(done, SHA)).toBe("complete");
  });

  it("refuses when a partial send of other events exists for the date", () => {
    const partial = log({ attachment_sha256: OTHER_SHA, sent: [{ to: RECIPIENTS[0], id: "re_1" }] });
    expect(scheduledEditionState(partial, SHA)).toBe("conflict");
  });
});
