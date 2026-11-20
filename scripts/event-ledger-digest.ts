/**
 * Daily Event Ledger edition: read new events from public.event_ledger, build
 * the email (HTML, plain text, attached events_<date>.jsonl) and send it with
 * Resend, either to one allowed address or, with --list, to the feed list.
 *
 * The schedule. The list edition goes out each weekday from the ERM3 Dagster job
 * erm3_event_ledger_daily (erm3/sec_overnight), which runs only after a successful SEC daily fetch
 * (erm3_sec_daily_delta) and a successful ledger publish; if either fails, no email goes out:
 *   npx tsx scripts/event-ledger-digest.ts --list --send --scheduled --advance-cursor
 * (the job runs under doppler erm3/prd, so the env is already present). The older launchd agent
 * (scripts/event-ledger-digest.launchd.plist, internal edition weekdays 07:30 PT) is retired once
 * that Dagster job is live: boot it out then (see the end of this header).
 *
 * Age rule (all editions read from a cursor): an event is listed only when its knowledge_at falls
 * within RECENT_KNOWLEDGE_DAYS (30) of the edition date. Events published in the window but first
 * knowable earlier, such as the Form 25 backfill, appear as one line, "N older events added to the
 * ledger", and are not listed or attached. Corrections and withdrawals are always listed.
 *
 * Modes
 *   (default)   one edition to --to (default conrad@bwmacro.com; ALLOWED_RECIPIENTS only).
 *               --internal builds the internal edition (adds internal_only rows under
 *               "Internal only, not for clients"); refused unless --to is in INTERNAL_RECIPIENTS.
 *   --list      the CLIENT edition to every address feed_waitlist_edition_recipients() returns
 *               (consented, not unsubscribed, confirmed delivery inboxes; one copy per address),
 *               each with its own footer (referral link, team-inbox link for contacts,
 *               unsubscribe, terms) and List-Unsubscribe headers. Refused with --internal.
 *               Without --send it is a dry run: it reads the recipient list, renders and checks
 *               every copy, writes a preview with no personal links to --out and prints counts;
 *               nothing is sent. An ad-hoc list send needs --send AND --confirm-list-send <N>, where
 *               N is the exact number of recipients; any other value refuses before anything is sent.
 *               An empty window (no main event, nothing under review, no older count) sends nothing
 *               in --list mode: it logs "skipped_empty"; with --advance-cursor the cursor moves past
 *               any rows read (all of them withheld), so they are not read again. The single-address
 *               mode still sends its "No new events" note.
 *   --scheduled With --list --send (and --advance-cursor): the Dagster run. Sends to every confirmed
 *               list recipient (accepted terms, confirmed address, not unsubscribed) without
 *               --confirm-list-send; reads the list cursor only (no --since-seq, knowledge window or
 *               --sample). One edition per edition date: when sent.json for the date is marked
 *               complete, a later scheduled run sends nothing ("skipped_already_sent", exit 0) and
 *               leaves its events for the next edition; a partial send of other events for the
 *               same date refuses (exit 4). It refuses (exit 3, cursor unchanged) an empty or
 *               unreadable recipient list, and takes no --out, --cursor or --edition-date: its state
 *               is always in ~/.riskmodels/event-ledger-digest. See lib/event-ledger-digest-schedule.ts.
 *   Flood guard. Every list send (scheduled, ad hoc, resume) refuses (exit 6, nothing sent, cursor
 *               unchanged) when the main section (verified events plus corrections and withdrawals)
 *               holds more than MAIN_SECTION_CAP (50) events, unless --confirm-main-count <N> equals
 *               that count (a wrong N refuses even under the cap). This keeps a history load, such
 *               as the Form 25 backfill and its corrections, out of a client edition: confirm the
 *               count to send it, or park the list cursor at the head with --init-cursor --list
 *               (sends nothing). --main-cap N lowers the cap for one run (0..50). A dry run reports
 *               main_over_cap instead of refusing.
 *   Pending list send. Before the first copy goes out, the list cursor file records pending_send
 *               (edition date, seq window); it is cleared when every copy went out. While it is set,
 *               every list send refuses (exit 4), so a partial send is never resent to everyone.
 *   --resume-pending
 *               With --list --send --confirm-list-send <N>: rebuilds exactly the pending edition
 *               (same rows, same edition date), sends only to addresses not yet in its sent.json,
 *               then moves the list cursor past it.
 *   --out       Dry runs and single-address runs only: every list send (--list --send) refuses it,
 *               so sent.json and pending_send's folder always live in the fixed directory.
 *   Lock.       Every list send holds ~/.riskmodels/event-ledger-digest/list-send.lock (exclusive
 *               create) from reading its state to writing it; a second run refuses (exit 5). A lock
 *               older than two hours is reported and refused, never broken: remove it by hand.
 *   --public-json <path>
 *               also write the public "latest events" file for riskmodels.org/events
 *               (lib/event-ledger-public.ts): the newest 20 verified, client-deliverable events,
 *               read independently of the cursor. Checked with the same output scans.
 *
 * Every edition passes the PR #533 checks before anything is written or sent:
 *   - buildDigest's licensing gate (redistributable public_record or derived only;
 *     restricted identifier keys withheld; internal_only only in an internal edition, only
 *     to INTERNAL_RECIPIENTS; market cap and raw licensed values withheld from client editions);
 *   - restrictedWordHits() on the HTML, the text and the attachment of EVERY copy;
 *   - priceOrCapHits() on every client copy (an exact market cap value or a price must never appear).
 *
 * Sending. Each copy carries a Resend idempotency key built from the recipient, the edition date and
 * the sha256 of the attached events, never the window, so a rerun of the same events to the same
 * address is dropped by the provider. sent.json in the edition folder is rewritten after every
 * successful send; a rerun reads it and skips addresses already sent for the same events. A 429 is
 * retried with exponential backoff (1, 2, 4, 8, 16 s).
 *
 * Cursors. The single-address run and the list run keep separate cursors
 * (~/.riskmodels/event-ledger-digest/cursor.json and cursor-list.json), so the internal
 * daily edition never swallows the window of a list edition. --cursor overrides.
 * First run of either: --init-cursor (with --list for the list cursor) starts at the ledger head.
 * --init-cursor --list also parks the list cursor at the head after a history load, skipping those
 * events without sending; it holds the send lock and refuses (exit 4) while a list send is pending.
 * The cursor moves only after every send succeeded and only with --advance-cursor.
 *
 * Review sample by knowledge date (does not read or move a cursor):
 *   ... --knowledge-from 2026-06-11 --knowledge-to 2026-06-15 --edition-date 2026-11-10 --sample
 *
 * Other flags: --no-under-review / --include-under-review, --review-cap N, --sample-label,
 * --sample-note, --since-seq N, --edition-date, --out DIR.
 *
 * Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, and for --send
 * RESEND_API_KEY (and optionally RESEND_FROM_EMAIL). Editions are not BCC'd to the audit mailbox:
 * an internal edition must reach INTERNAL_RECIPIENTS only, and list copies are logged in sent.json.
 *
 * The retired launchd agent (a user LaunchAgent; no sudo). Turn it off once the Dagster job is live:
 *   cp scripts/event-ledger-digest.launchd.plist ~/Library/LaunchAgents/com.bwmacro.event-ledger-digest.plist
 *   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bwmacro.event-ledger-digest.plist
 *   Off: launchctl bootout gui/$(id -u)/com.bwmacro.event-ledger-digest
 *   Log: ~/Library/Logs/event-ledger-digest.log.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { render } from "@react-email/render";
import { Resend } from "resend";
import { EventLedgerDigestEmail } from "../emails/event-ledger-digest";
import { DEFAULT_RESEND_FROM, SUPPORT_EMAIL } from "../emails/constants";
import {
  ATTACHMENT_MEDIA_TYPE,
  INTERNAL_RECIPIENTS,
  buildDigest,
  digestSubject,
  isEmptyEdition,
  editionFooter,
  internalFooter,
  priceOrCapHits,
  renderDigestText,
  restrictedWordHits,
  type DigestEdition,
  type DigestWindow,
  type EditionFooter,
  type FooterRecipient,
  type LedgerRow,
} from "../lib/event-ledger-digest";
import { loadPublicLatest } from "../lib/event-ledger-public";
import { buildMimeMessage } from "../lib/event-ledger-digest-mime";
import {
  MAIN_SECTION_CAP,
  acquireSendLock,
  listSendGate,
  mainCapOption,
  mainSectionGate,
  pendingSendGate,
  scheduledEditionState,
  type CursorFile,
  type ListSendFlags,
  type PendingSend,
  type SentLogState,
} from "../lib/event-ledger-digest-schedule";

/** The only addresses a single-address edition may go to. List sends go to the list. */
const ALLOWED_RECIPIENTS = ["conrad@bwmacro.com"] as const;

const STATE_DIR = join(homedir(), ".riskmodels", "event-ledger-digest");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function env(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("missing_supabase_env");
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = env();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`supabase_read_failed_${res.status}`);
  return (await res.json()) as T;
}

async function getRows(query: string): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest<LedgerRow[]>(
      `event_ledger?select=seq,published_at,envelope&${query}&order=seq.asc&limit=1000&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function headSeq(): Promise<number> {
  const rows = await rest<{ seq: number }[]>("event_ledger?select=seq&order=seq.desc&limit=1");
  return rows[0]?.seq ?? 0;
}

interface ListRecipient extends FooterRecipient {
  email: string;
}

/** The list, or null when the response is not an array (the caller refuses). */
async function listRecipients(): Promise<ListRecipient[] | null> {
  const rows = await rest<unknown>("rpc/feed_waitlist_edition_recipients", { method: "POST", body: "{}" });
  return Array.isArray(rows) ? (rows as ListRecipient[]) : null;
}

/** The single address's own footer when it is on the list; the plain footer otherwise or before the migration. */
async function footerFor(email: string): Promise<EditionFooter> {
  try {
    const rows = await rest<FooterRecipient[]>(
      `feed_waitlist?select=unsubscribe_token,purpose,referral_code&email=eq.${encodeURIComponent(email)}&consent_feed_emails=is.true&unsubscribed_at=is.null&limit=1`,
    );
    return editionFooter(rows[0] ?? null);
  } catch {
    return editionFooter(null);
  }
}

function readCursorFile(path: string): CursorFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CursorFile;
}

function readCursor(path: string): number | null {
  const f = readCursorFile(path);
  return f ? Number(f.last_seq) : null;
}

/** Records (or, with null, clears) a list send in progress, keeping the cursor's position. */
function setPending(path: string, pending: PendingSend | null) {
  const f = readCursorFile(path) ?? { last_seq: pending?.after_seq ?? 0 };
  const { saved_at: _saved, pending_send: _old, ...rest } = f;
  writeFileSync(
    path,
    JSON.stringify({ ...rest, saved_at: new Date().toISOString(), ...(pending ? { pending_send: pending } : {}) }, null, 2) + "\n",
  );
}

function writeCursor(path: string, seq: number, extra: Record<string, unknown>) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ last_seq: seq, saved_at: new Date().toISOString(), ...extra }, null, 2) + "\n");
}

/** Calendar date in Pacific time, offset by `days`. */
function ptDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function unsubscribeHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  const oneClick = `https://riskmodels.app/api/feed-waitlist/unsubscribe?token=${encodeURIComponent(token)}`;
  return {
    "List-Unsubscribe": `<${oneClick}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe%20feed>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

interface Copy {
  to: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** Renders one recipient's copy and runs every output check on it. Throws on a hit; nothing is sent. */
async function renderCopy(edition: DigestEdition, to: string, footer: EditionFooter, token: string | null): Promise<Copy> {
  const html = await render(EventLedgerDigestEmail({ edition, footer }));
  const text = renderDigestText(edition, footer);
  if (restrictedWordHits(html, text, edition.attachment.body).length) throw new Error("refused_restricted_words");
  if (edition.audience === "client" && priceOrCapHits(html, text, edition.attachment.body).length) {
    throw new Error("refused_market_cap_or_price");
  }
  return { to, html, text, headers: unsubscribeHeaders(token) };
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_RESEND_FROM;
}

/** Per recipient, per edition date, per set of events: not tied to the window. */
function idempotencyKey(edition: DigestEdition, to: string): string {
  return createHash("sha256")
    .update(`${edition.editionDate}|${edition.audience}|${edition.attachment.sha256}|${to.toLowerCase()}`)
    .digest("hex")
    .slice(0, 48);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Resend send. No audit BCC (see header). Retries a 429 with exponential backoff. */
async function sendCopy(resend: Resend, edition: DigestEdition, subject: string, c: Copy): Promise<string> {
  const idem = idempotencyKey(edition, c.to);
  for (let attempt = 0; ; attempt++) {
    const id = await sendOnce(resend, edition, subject, c, idem);
    if (id !== "rate_limited") return id;
    if (attempt >= 5) throw new Error("send_failed_rate_limited");
    await sleep(1000 * 2 ** attempt);
  }
}

async function sendOnce(resend: Resend, edition: DigestEdition, subject: string, c: Copy, idem: string): Promise<string> {
  const result = await resend.emails.send(
    {
      from: fromAddress(),
      to: c.to,
      replyTo: SUPPORT_EMAIL,
      subject,
      html: c.html,
      text: c.text,
      headers: c.headers,
      attachments: [
        {
          filename: edition.attachment.filename,
          content: Buffer.from(edition.attachment.body, "utf8"),
          contentType: ATTACHMENT_MEDIA_TYPE,
        },
      ],
      tags: [{ name: "category", value: `event_ledger_${edition.audience}` }],
    },
    { idempotencyKey: `event-ledger/${idem}` },
  );
  const err = result.error as { name?: string; statusCode?: number } | null;
  if (err && (err.statusCode === 429 || err.name === "rate_limit_exceeded")) return "rate_limited";
  if (err || !result.data?.id) throw new Error("send_failed");
  return result.data.id;
}

interface SentLog extends SentLogState {
  subject: string;
}

function readSentLogRaw(path: string): SentLog | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SentLog;
  } catch {
    return null;
  }
}

function readSentLog(path: string, edition: DigestEdition): SentLog["sent"] {
  const log = readSentLogRaw(path);
  return log && log.attachment_sha256 === edition.attachment.sha256 && Array.isArray(log.sent) ? log.sent : [];
}

async function writePublicJson(path: string) {
  // Verified events plus every withdrawal or correction, so superseded originals are dropped.
  const file = await loadPublicLatest(getRows, { generatedAt: new Date().toISOString() });
  const body = JSON.stringify(file, null, 2) + "\n";
  if (restrictedWordHits(body).length || priceOrCapHits(body).length) throw new Error("refused_public_json_output_check");
  writeFileSync(resolve(path), body);
  return { path: resolve(path), events: file.count, latest_known_date: file.latest_known_date };
}

async function main() {
  const list = flag("list");
  const cursorPath = arg("cursor") ?? join(STATE_DIR, list ? "cursor-list.json" : "cursor.json");

  if (flag("init-cursor")) {
    // The list cursor is moved under the send lock, and never while a list send is pending: that
    // would drop the record of who still has to receive the pending edition.
    if (list) {
      mkdirSync(STATE_DIR, { recursive: true });
      const lock = acquireSendLock(join(STATE_DIR, "list-send.lock"));
      if (!lock.ok) {
        console.error(`refused: ${lock.reason}; ${join(STATE_DIR, "list-send.lock")} is held; cursor unchanged`);
        process.exit(5);
      }
      process.on("exit", lock.release);
      const pending = readCursorFile(cursorPath)?.pending_send;
      if (pending) {
        console.error(
          `refused: pending_partial_send; the ${pending.edition_date} list edition did not finish. Resume it first ` +
            "(--list --send --resume-pending --confirm-list-send <N>); cursor unchanged",
        );
        process.exit(4);
      }
    }
    const before = readCursor(cursorPath);
    const head = await headSeq();
    writeCursor(cursorPath, head, {
      note: "initialised at ledger head; no edition sent",
      ...(before !== null ? { previous_seq: before } : {}),
    });
    console.log(
      `cursor initialised at seq ${head}${before !== null ? ` (was ${before}; positions ${before + 1}..${head} skipped, nothing sent)` : ""}: ${cursorPath}`,
    );
    return;
  }

  const mainCap = mainCapOption(arg("main-cap"));
  if (mainCap === null) {
    console.error(`refused: --main-cap takes an integer from 0 to ${MAIN_SECTION_CAP}; it can only lower the cap; nothing sent`);
    process.exit(2);
  }

  const sendFlags: ListSendFlags = {
    list,
    send: flag("send"),
    scheduled: flag("scheduled"),
    confirmListSend: arg("confirm-list-send"),
    knowledgeWindow: Boolean(arg("knowledge-from") || arg("knowledge-to")),
    sinceSeq: arg("since-seq") !== undefined,
    sample: flag("sample"),
    advanceCursor: flag("advance-cursor"),
    editionDate: arg("edition-date") !== undefined,
    resumePending: flag("resume-pending"),
    out: arg("out") !== undefined,
    cursor: arg("cursor") !== undefined,
    reviewOptions: flag("include-under-review") || flag("no-under-review") || arg("review-cap") !== undefined,
  };
  const early = listSendGate(sendFlags, null);
  if (!early.ok) {
    console.error(
      `refused: ${early.reason}; --scheduled is --list --send --advance-cursor from the fixed list cursor only, ` +
        "--resume-pending is --list --send --confirm-list-send N alone; nothing sent",
    );
    process.exit(2);
  }

  // Every list send holds the lock from reading its state to writing it, so overlapping runs
  // cannot both send. Released on any exit; a stale lock is reported, never broken.
  const listSend = list && sendFlags.send;
  if (listSend) {
    mkdirSync(STATE_DIR, { recursive: true });
    const lock = acquireSendLock(join(STATE_DIR, "list-send.lock"));
    if (!lock.ok) {
      console.error(
        `refused: ${lock.reason}; ${join(STATE_DIR, "list-send.lock")} is held (${Math.round(lock.ageMs / 60000)} min, ${lock.holder || "no holder"}). ` +
          (lock.reason === "stale_lock" ? "Check no run is alive, then remove it by hand. " : "") +
          "nothing sent",
      );
      process.exit(5);
    }
    process.on("exit", lock.release);
    // A signal ends the run with the lock released; pending_send stays, so the send is resumed, not resent.
    for (const [sig, code] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
      process.on(sig, () => {
        lock.release();
        console.error(`event-ledger-digest: ${sig}; lock released; any pending send stays recorded`);
        process.exit(code);
      });
    }
  }

  const audience = flag("internal") ? "internal" : "client";
  const to = arg("to") ?? ALLOWED_RECIPIENTS[0];
  if (list) {
    if (audience === "internal" || arg("to")) {
      console.error("refused: --list sends the client edition to the list; it takes neither --internal nor --to");
      process.exit(2);
    }
  } else {
    if (!(ALLOWED_RECIPIENTS as readonly string[]).includes(to)) {
      console.error("refused: recipient is not on the allowed list");
      process.exit(2);
    }
    if (audience === "internal" && !INTERNAL_RECIPIENTS.includes(to)) {
      console.error("refused: an internal edition may go only to an internal recipient");
      process.exit(2);
    }
  }

  // A list send that did not finish blocks every later list send until it is resumed.
  let resume: PendingSend | null = null;
  if (listSend) {
    const pg = pendingSendGate(readCursorFile(cursorPath), sendFlags.resumePending);
    if (!pg.ok) {
      console.error(
        pg.reason === "pending_partial_send"
          ? `refused: pending_partial_send; the ${pg.pending!.edition_date} list edition (seq ${pg.pending!.after_seq}..${pg.pending!.through_seq}) did not finish. ` +
              `Resume it with --list --send --resume-pending --confirm-list-send <N>; nothing sent`
          : "refused: no_pending_send; there is no pending list send to resume; nothing sent",
      );
      process.exit(pg.reason === "pending_partial_send" ? 4 : 2);
    }
    resume = pg.resume;
  }

  // Edition date: the day the edition covers, which is the day before the send (Pacific).
  const editionDate = resume?.edition_date ?? arg("edition-date") ?? ptDate(-1);
  const kFrom = arg("knowledge-from");
  const kTo = arg("knowledge-to");

  let window: DigestWindow;
  let rows: LedgerRow[];
  if (kFrom || kTo) {
    if (!kFrom || !kTo) throw new Error("--knowledge-from and --knowledge-to go together");
    window = { basis: "knowledge_date", from: kFrom, to: kTo };
    rows = await getRows(`knowledge_at=gte.${kFrom}T00:00:00Z&knowledge_at=lt.${nextDay(kTo)}T00:00:00Z`);
  } else if (resume) {
    // Exactly the pending edition's rows, so its attachment (and sent.json) match.
    rows = await getRows(`seq=gt.${resume.after_seq}&seq=lte.${resume.through_seq}`);
    window = { basis: "ledger_seq", after_seq: resume.after_seq, through_seq: resume.through_seq };
  } else {
    const since = arg("since-seq") !== undefined ? Number(arg("since-seq")) : readCursor(cursorPath);
    if (since === null || !Number.isFinite(since)) {
      console.error(`no cursor at ${cursorPath}; run once with --init-cursor${list ? " --list" : ""}, or pass --since-seq N`);
      process.exit(2);
    }
    rows = await getRows(`seq=gt.${since}`);
    window = { basis: "ledger_seq", after_seq: since, through_seq: rows.length ? rows[rows.length - 1].seq : since };
  }

  const edition = buildDigest(rows, {
    editionDate,
    window,
    sample: flag("sample"),
    sampleNote: arg("sample-note") ?? null,
    sampleLabel: arg("sample-label") ?? null,
    includeUnderReview: flag("no-under-review") ? false : flag("include-under-review") ? true : undefined,
    audience,
    recipient: list ? undefined : to,
    reviewCap: arg("review-cap") !== undefined ? Number(arg("review-cap")) : undefined,
  });
  const subject = digestSubject(edition);

  // Flood guard, before the recipient list is read or anything is recorded or sent.
  const flood = mainSectionGate(edition.mainCount, arg("confirm-main-count"), mainCap);
  if (listSend && !flood.ok) {
    console.error(
      flood.reason === "confirm_main_count_mismatch"
        ? `refused: confirm_main_count_mismatch; the main section holds ${flood.mainCount} events, not ${arg("confirm-main-count")}; nothing sent; the cursor is unchanged`
        : `refused: main_section_over_cap; the main section holds ${flood.mainCount} events (cap ${flood.cap}); nothing sent; the cursor is unchanged. ` +
            `To send it: --confirm-main-count ${flood.mainCount} on an ad-hoc list send. To skip these events: --init-cursor --list parks the list cursor at the ledger head`,
    );
    process.exit(6);
  }

  // Recipients and their copies. Every copy is rendered and checked before the first send.
  const listed = list ? await listRecipients() : null;
  if (list && listed === null) {
    console.error("refused: recipient_list_unreadable; feed_waitlist_edition_recipients() did not return a list; nothing sent");
    process.exit(3);
  }
  if (sendFlags.scheduled) {
    const g = listSendGate(sendFlags, (listed ?? []).length);
    if (!g.ok) {
      console.error(`refused: ${g.reason}; the cursor is unchanged; nothing sent`);
      process.exit(3);
    }
  }
  const recipients: ListRecipient[] = list
    ? (listed as ListRecipient[])
    : [{ email: to, unsubscribe_token: "", purpose: null, referral_code: null }];
  const copies: Copy[] = [];
  try {
    if (list) {
      for (const r of recipients) copies.push(await renderCopy(edition, r.email, editionFooter(r), r.unsubscribe_token));
    } else if (audience === "internal") {
      // No forward link and no personal token in an internal edition.
      copies.push(await renderCopy(edition, to, internalFooter(), null));
    } else {
      const footer = await footerFor(to);
      const token = footer.unsubscribeUrl ? new URL(footer.unsubscribeUrl).searchParams.get("token") : null;
      copies.push(await renderCopy(edition, to, footer, token));
    }
  } catch (err) {
    console.error(`refused: ${err instanceof Error ? err.message : "render_failed"}; nothing sent`);
    process.exit(3);
  }

  // A resume writes to the folder its pending send recorded (belt and braces: --out is refused on list sends).
  const outDir = resolve(
    resume?.out_dir ?? arg("out") ?? join(STATE_DIR, "editions", `${editionDate}${list ? "_list" : ""}${edition.sample ? "_sample" : ""}`),
  );
  mkdirSync(outDir, { recursive: true });
  // A list preview carries no recipient's links or tokens.
  const preview = list ? (copies.length ? await renderCopy(edition, "list-preview", editionFooter(null), null) : null) : copies[0];
  if (preview) {
    writeFileSync(join(outDir, "edition.html"), preview.html);
    writeFileSync(join(outDir, "edition.txt"), preview.text);
    writeFileSync(
      join(outDir, "message.eml"),
      buildMimeMessage({
        to: list ? "list-preview" : preview.to,
        subject,
        text: preview.text,
        html: preview.html,
        attachment: { filename: edition.attachment.filename, contentType: ATTACHMENT_MEDIA_TYPE, body: edition.attachment.body },
      }),
    );
  }
  writeFileSync(join(outDir, edition.attachment.filename), edition.attachment.body);

  const publicJson = arg("public-json") ? await writePublicJson(arg("public-json") as string) : null;

  const summary = {
    subject,
    mode: list ? "list" : "single",
    window,
    rows_read: rows.length,
    main: edition.mainCount,
    corrections: edition.correctionCount,
    replaced_by_later_event: edition.replaced,
    main_cap: mainCap,
    main_over_cap: !flood.ok,
    older_not_listed: edition.older,
    scheduled: sendFlags.scheduled,
    audience,
    recipients: copies.length,
    recipients_by_purpose: list
      ? recipients.reduce<Record<string, number>>((a, r) => ((a[String(r.purpose ?? "contact")] = (a[String(r.purpose ?? "contact")] ?? 0) + 1), a), {})
      : undefined,
    under_review: { shown: edition.underReview.items.length, total: edition.underReview.total },
    internal_only: { shown: edition.internalOnly.items.length, total: edition.internalOnly.total },
    withheld: edition.withheld,
    families: Object.fromEntries(edition.families.map((f) => [f.label, f.items.length])),
    attachment: { filename: edition.attachment.filename, lines: edition.attachment.lines, sha256: edition.attachment.sha256 },
    public_json: publicJson,
    out: outDir,
  };

  if (list && isEmptyEdition(edition)) {
    // Rows read but all withheld: move past them so they are not read again.
    const advanced =
      flag("send") && flag("advance-cursor") && window.basis === "ledger_seq" && window.through_seq > window.after_seq;
    if (advanced && window.basis === "ledger_seq") {
      writeCursor(cursorPath, window.through_seq, { edition_date: editionDate, sent: 0, mode: summary.mode, skipped_empty: true });
    }
    console.log(JSON.stringify({ ...summary, sent: 0, skipped_empty: true, cursor_advanced: advanced }, null, 2));
    return;
  }
  if (!flag("send")) {
    console.log(JSON.stringify({ ...summary, sent: false, dry_run: true }, null, 2));
    return;
  }
  const gate = listSendGate(sendFlags, copies.length);
  if (!gate.ok) {
    if (gate.reason !== "confirm_list_send_required") {
      console.error(`refused: ${gate.reason}; nothing sent`);
      process.exit(2);
    }
    console.error(`refused: a list send needs --confirm-list-send ${copies.length} (the exact recipient count); nothing sent`);
    process.exit(2);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("refused: RESEND_API_KEY is not set; nothing sent");
    process.exit(2);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const logPath = join(outDir, "sent.json");
  if (sendFlags.scheduled) {
    const state = scheduledEditionState(readSentLogRaw(logPath), edition.attachment.sha256);
    if (state === "complete") {
      console.log(JSON.stringify({ ...summary, sent: 0, skipped_already_sent: true }, null, 2));
      return;
    }
    if (state === "conflict") {
      console.error(`refused: ${logPath} holds a partial send of other events for ${editionDate}; nothing sent`);
      process.exit(4);
    }
  }
  // A resume skips every address already sent for that edition, whatever the rebuilt sha.
  const resumeLog = resume ? readSentLogRaw(join(outDir, "sent.json")) : null;
  const shaMismatch = Boolean(resume?.attachment_sha256 && resume.attachment_sha256 !== edition.attachment.sha256);
  if (shaMismatch) {
    console.error(
      `resume_sha_mismatch: the rebuilt ${editionDate} edition differs from the one the pending send started with; ` +
        "addresses already sent are still skipped",
    );
  }
  const sent = resume ? [...(resumeLog?.sent ?? [])] : readSentLog(logPath, edition);
  // Recorded before the first send and cleared only when every copy went out, so a crash or a
  // failed copy blocks the next list send instead of resending the window to everyone.
  const trackPending = list && window.basis === "ledger_seq" && !sendFlags.sinceSeq;
  if (trackPending && window.basis === "ledger_seq") {
    setPending(cursorPath, {
      edition_date: editionDate,
      after_seq: window.after_seq,
      through_seq: window.through_seq,
      started_at: resume?.started_at ?? new Date().toISOString(),
      out_dir: outDir,
      attachment_sha256: resume?.attachment_sha256 ?? edition.attachment.sha256,
    });
  }
  const already = new Set(sent.map((x) => x.to.toLowerCase()));
  const failed: string[] = [];
  const writeLog = (complete = false) =>
    writeFileSync(
      logPath,
      JSON.stringify(
        { updated_at: new Date().toISOString(), subject, attachment_sha256: edition.attachment.sha256, sent, failed, complete },
        null,
        2,
      ) + "\n",
    );
  for (const c of copies) {
    if (already.has(c.to.toLowerCase())) continue;
    try {
      sent.push({ to: c.to, id: await sendCopy(resend, edition, subject, c) });
      writeLog();
    } catch {
      failed.push(c.to);
    }
  }
  writeLog(failed.length === 0);

  if (!failed.length && (flag("advance-cursor") || resume) && window.basis === "ledger_seq") {
    writeCursor(cursorPath, window.through_seq, { edition_date: editionDate, sent: sent.length, mode: summary.mode });
  } else if (!failed.length && trackPending) {
    setPending(cursorPath, null);
  }
  console.log(JSON.stringify({ ...summary, sent: sent.length, failed: failed.length, ...(shaMismatch ? { resume_sha_mismatch: true } : {}) }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("event-ledger-digest failed:", err instanceof Error ? err.message : "unknown_error");
  process.exit(1);
});
