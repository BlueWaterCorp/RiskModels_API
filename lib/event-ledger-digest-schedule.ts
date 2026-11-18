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
 * Guards on every list send:
 *   - a scheduled run refuses an empty or unreadable recipient list, so the cursor never moves past
 *     events nobody received; it needs --advance-cursor and keeps its state in the fixed folder
 *     (no --out, --cursor, --edition-date);
 *   - a list send that did not finish leaves pending_send in the list cursor file. Every later list
 *     send refuses (exit 4) until it is resumed with --list --send --resume-pending
 *     --confirm-list-send <N>, which rebuilds exactly that edition (same rows, same edition date),
 *     skips addresses already sent and then moves the cursor;
 *   - an exclusive lock file around read-state -> send -> write-state, so two overlapping runs
 *     cannot both send. A lock older than LOCK_STALE_MS is reported and refused, never broken.
 *
 * One scheduled edition per edition date: once an edition date has gone out in full (sent.json
 * marked complete), a later scheduled run for that date sends nothing, whatever its events; those
 * events stay behind the cursor for the next edition. A partial send of different events for the
 * same date is refused for the operator to look at.
 */

import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

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
  advanceCursor: boolean;
  /** --edition-date given. */
  editionDate: boolean;
  resumePending: boolean;
  /** --out given. */
  out: boolean;
  /** --cursor given. */
  cursor: boolean;
}

export type GateResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "confirm_list_send_required"
        | "scheduled_needs_list"
        | "scheduled_needs_send"
        | "scheduled_needs_advance_cursor"
        | "scheduled_cursor_only"
        | "scheduled_fixed_state"
        | "scheduled_no_recipients"
        | "resume_needs_list_send"
        | "resume_takes_pending_window";
    };

/**
 * Whether a run may go ahead. `recipients` is the number of list recipients, or null before the
 * list is read (the early check, flags only).
 */
export function listSendGate(f: ListSendFlags, recipients: number | null): GateResult {
  if (f.scheduled) {
    if (!f.list) return { ok: false, reason: "scheduled_needs_list" };
    if (!f.send) return { ok: false, reason: "scheduled_needs_send" };
    if (!f.advanceCursor) return { ok: false, reason: "scheduled_needs_advance_cursor" };
    if (f.knowledgeWindow || f.sinceSeq || f.sample || f.editionDate || f.resumePending) {
      return { ok: false, reason: "scheduled_cursor_only" };
    }
    if (f.out || f.cursor) return { ok: false, reason: "scheduled_fixed_state" };
    if (recipients === 0) return { ok: false, reason: "scheduled_no_recipients" };
    return { ok: true };
  }
  if (f.resumePending) {
    if (!f.list || !f.send) return { ok: false, reason: "resume_needs_list_send" };
    if (f.knowledgeWindow || f.sinceSeq || f.sample || f.editionDate) return { ok: false, reason: "resume_takes_pending_window" };
  }
  if (recipients !== null && f.list && f.send && f.confirmListSend !== String(recipients)) {
    return { ok: false, reason: "confirm_list_send_required" };
  }
  return { ok: true };
}

/** A list send that started and did not finish, recorded in the list cursor file. */
export interface PendingSend {
  edition_date: string;
  after_seq: number;
  through_seq: number;
  started_at: string;
}

export interface CursorFile {
  last_seq: number;
  pending_send?: PendingSend | null;
  [key: string]: unknown;
}

export type PendingGateResult =
  | { ok: true; resume: PendingSend | null }
  | { ok: false; reason: "pending_partial_send" | "no_pending_send"; pending: PendingSend | null };

/** Refuses a list send while one is pending, unless it is the --resume-pending run. */
export function pendingSendGate(cursor: CursorFile | null, resumePending: boolean): PendingGateResult {
  const pending = cursor?.pending_send ?? null;
  if (resumePending) return pending ? { ok: true, resume: pending } : { ok: false, reason: "no_pending_send", pending: null };
  if (pending) return { ok: false, reason: "pending_partial_send", pending };
  return { ok: true, resume: null };
}

/** A lock older than this is stale: reported and refused, never broken. */
export const LOCK_STALE_MS = 2 * 3600_000;

export type LockResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: "locked" | "stale_lock"; ageMs: number; holder: string };

/** Exclusive lock file (O_EXCL create). */
export function acquireSendLock(path: string, now: number = Date.now()): LockResult {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date(now).toISOString() }) + "\n");
    closeSync(fd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    let ageMs = 0;
    let holder = "";
    try {
      ageMs = now - statSync(path).mtimeMs;
      holder = readFileSync(path, "utf8").trim();
    } catch {
      // Removed between the create and the stat: treat as held this time.
    }
    return { ok: false, reason: ageMs > LOCK_STALE_MS ? "stale_lock" : "locked", ageMs, holder };
  }
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    },
  };
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
