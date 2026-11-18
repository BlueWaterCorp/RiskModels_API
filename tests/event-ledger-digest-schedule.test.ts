import { mkdtempSync, existsSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireSendLock,
  listSendGate,
  pendingSendGate,
  scheduledEditionState,
  type ListSendFlags,
  type PendingSend,
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
  advanceCursor: true,
  confirmListSend: undefined,
  knowledgeWindow: false,
  sinceSeq: false,
  sample: false,
  editionDate: false,
  resumePending: false,
  out: false,
  cursor: false,
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
    // Before the list is read (the early check), the count is unknown.
    expect(listSendGate(flags({ scheduled: true }), null)).toEqual({ ok: true });
  });

  it("refuses a scheduled send to an empty list, so the cursor never moves past unsent events", () => {
    expect(listSendGate(flags({ scheduled: true }), 0)).toEqual({ ok: false, reason: "scheduled_no_recipients" });
  });

  it("requires --advance-cursor and refuses --edition-date with --scheduled", () => {
    expect(listSendGate(flags({ scheduled: true, advanceCursor: false }), 2)).toEqual({
      ok: false,
      reason: "scheduled_needs_advance_cursor",
    });
    expect(listSendGate(flags({ scheduled: true, editionDate: true }), 2)).toEqual({
      ok: false,
      reason: "scheduled_cursor_only",
    });
  });

  it("keeps scheduled state in the fixed folder: no --out, no --cursor", () => {
    for (const over of [{ out: true }, { cursor: true }]) {
      expect(listSendGate(flags({ scheduled: true, ...over }), 2)).toEqual({ ok: false, reason: "scheduled_fixed_state" });
    }
  });

  it("keeps --resume-pending manual: it needs the exact count and refuses --scheduled", () => {
    expect(listSendGate(flags({ resumePending: true }), 2)).toEqual({ ok: false, reason: "confirm_list_send_required" });
    expect(listSendGate(flags({ resumePending: true, confirmListSend: "2" }), 2)).toEqual({ ok: true });
    expect(listSendGate(flags({ resumePending: true, scheduled: true }), 2)).toEqual({
      ok: false,
      reason: "scheduled_cursor_only",
    });
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

describe("pending list send (a send that did not finish)", () => {
  const pending: PendingSend = {
    edition_date: "2026-11-16",
    after_seq: 5050,
    through_seq: 8785,
    started_at: "2026-11-17T15:40:12.000Z",
  };

  it("lets a run go ahead when nothing is pending", () => {
    expect(pendingSendGate(null, false)).toEqual({ ok: true, resume: null });
    expect(pendingSendGate({ last_seq: 5050 }, false)).toEqual({ ok: true, resume: null });
  });

  it("refuses every list send while an earlier send is pending, so no one gets it twice", () => {
    expect(pendingSendGate({ last_seq: 5050, pending_send: pending }, false)).toEqual({
      ok: false,
      reason: "pending_partial_send",
      pending,
    });
  });

  it("resumes exactly the pending edition with --resume-pending, and refuses it when nothing is pending", () => {
    expect(pendingSendGate({ last_seq: 5050, pending_send: pending }, true)).toEqual({ ok: true, resume: pending });
    expect(pendingSendGate({ last_seq: 5050 }, true)).toEqual({ ok: false, reason: "no_pending_send", pending: null });
  });
});

describe("list send lock (two overlapping runs cannot both send)", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "ledger-lock-"));
  const NOW = Date.parse("2026-11-17T15:30:00Z");

  it("takes the lock once; a second run is refused while it is held; release removes it", () => {
    const path = join(dir(), "list-send.lock");
    const first = acquireSendLock(path, NOW);
    expect(first.ok).toBe(true);
    const second = acquireSendLock(path, NOW + 60_000);
    expect(second).toMatchObject({ ok: false, reason: "locked" });
    if (first.ok) first.release();
    expect(existsSync(path)).toBe(false);
    const third = acquireSendLock(path, NOW + 120_000);
    expect(third.ok).toBe(true);
    if (third.ok) third.release();
  });

  it("reports a lock older than two hours as stale and refuses; it does not break it", () => {
    const path = join(dir(), "list-send.lock");
    writeFileSync(path, JSON.stringify({ pid: 1, started_at: "2026-11-17T12:00:00Z" }));
    const old = (NOW - 3 * 3600_000) / 1000;
    utimesSync(path, old, old);
    expect(acquireSendLock(path, NOW)).toMatchObject({ ok: false, reason: "stale_lock" });
    expect(existsSync(path)).toBe(true);
  });
});
