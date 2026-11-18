/**
 * Send gates for scripts/event-ledger-digest.ts, kept pure so they are tested.
 *
 * Two ways a list edition goes out:
 *   - ad hoc: --list --send --confirm-list-send <N>, where N is the exact recipient count;
 *   - scheduled: --list --send --scheduled --advance-cursor, run by the ERM3 Dagster job
 *     erm3_event_ledger_daily after the SEC daily fetch and the ledger publish succeed. It sends to
 *     every confirmed list recipient (feed_waitlist_edition_recipients(): accepted terms, confirmed
 *     address, not unsubscribed) with no count, and reads only the list cursor.
 *
 * One scheduled edition per edition date: once an edition date has gone out in full (sent.json
 * marked complete), a later scheduled run for that date sends nothing, whatever its events; those
 * events stay behind the cursor for the next edition. A partial send of different events for the
 * same date is refused for the operator to look at.
 */

export interface ListSendFlags {
  list: boolean;
  send: boolean;
  scheduled: boolean;
  /** Value of --confirm-list-send, if given. */
  confirmListSend: string | undefined;
  /** --knowledge-from / --knowledge-to given. */
  knowledgeWindow: boolean;
  /** --since-seq given. */
  sinceSeq: boolean;
  sample: boolean;
}

export type GateResult =
  | { ok: true }
  | {
      ok: false;
      reason: "confirm_list_send_required" | "scheduled_needs_list" | "scheduled_needs_send" | "scheduled_cursor_only";
    };

/** Whether a run may go ahead to the send step. `recipients` is the number of list copies rendered. */
export function listSendGate(f: ListSendFlags, recipients: number): GateResult {
  if (f.scheduled) {
    if (!f.list) return { ok: false, reason: "scheduled_needs_list" };
    if (!f.send) return { ok: false, reason: "scheduled_needs_send" };
    if (f.knowledgeWindow || f.sinceSeq || f.sample) return { ok: false, reason: "scheduled_cursor_only" };
    return { ok: true };
  }
  if (f.list && f.send && f.confirmListSend !== String(recipients)) {
    return { ok: false, reason: "confirm_list_send_required" };
  }
  return { ok: true };
}

/** sent.json in an edition folder, the fields the gate reads. */
export interface SentLogState {
  attachment_sha256: string;
  sent: { to: string; id: string }[];
  failed: string[];
  /** Set when every copy of the edition was sent (no failures). */
  complete?: boolean;
}

export type ScheduledState = "fresh" | "resume" | "complete" | "conflict";

/**
 * fresh: nothing sent for this edition date. resume: same events, partly sent; skip addresses
 * already sent. complete: the date already went out in full; send nothing. conflict: a partial send
 * of other events exists for the date; refuse.
 */
export function scheduledEditionState(log: SentLogState | null, sha: string): ScheduledState {
  if (!log) return "fresh";
  if (log.complete === true && Array.isArray(log.sent) && log.sent.length) return "complete";
  const anySent = Array.isArray(log.sent) && log.sent.length > 0;
  if (log.attachment_sha256 === sha) return anySent ? "resume" : "fresh";
  return anySent ? "conflict" : "fresh";
}
