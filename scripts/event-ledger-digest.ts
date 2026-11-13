/**
 * Daily Event Ledger edition: read new events from public.event_ledger, build
 * the email (HTML, plain text, attached events_<date>.jsonl) and send it with
 * Resend, either to one allowed address or, with --list, to the feed list.
 *
 * The schedule (scripts/event-ledger-digest.launchd.plist, weekdays 07:30 PT):
 *   doppler run --project erm3 --config prd -- \
 *     npx tsx scripts/event-ledger-digest.ts --internal --send --advance-cursor
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
 *               nothing is sent. A real list send needs --send AND --confirm-list-send <N>, where N
 *               is the exact number of recipients; any other value refuses before anything is sent.
 *               An empty window (no main event, nothing under review) sends nothing in --list mode:
 *               it logs "skipped_empty" and leaves the cursor alone. The single-address mode still
 *               sends its "No new events" note.
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
 * Turning the schedule on or off (a user LaunchAgent; no sudo):
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

async function listRecipients(): Promise<ListRecipient[]> {
  const rows = await rest<ListRecipient[]>("rpc/feed_waitlist_edition_recipients", { method: "POST", body: "{}" });
  return Array.isArray(rows) ? rows : [];
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

function readCursor(path: string): number | null {
  if (!existsSync(path)) return null;
  return Number(JSON.parse(readFileSync(path, "utf8")).last_seq);
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

interface SentLog {
  subject: string;
  attachment_sha256: string;
  sent: { to: string; id: string }[];
  failed: string[];
}

function readSentLog(path: string, edition: DigestEdition): SentLog["sent"] {
  if (!existsSync(path)) return [];
  try {
    const log = JSON.parse(readFileSync(path, "utf8")) as SentLog;
    return log.attachment_sha256 === edition.attachment.sha256 && Array.isArray(log.sent) ? log.sent : [];
  } catch {
    return [];
  }
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
    const head = await headSeq();
    writeCursor(cursorPath, head, { note: "initialised at ledger head; no edition sent" });
    console.log(`cursor initialised at seq ${head}: ${cursorPath}`);
    return;
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

  // Edition date: the day the edition covers, which is the day before the send (Pacific).
  const editionDate = arg("edition-date") ?? ptDate(-1);
  const kFrom = arg("knowledge-from");
  const kTo = arg("knowledge-to");

  let window: DigestWindow;
  let rows: LedgerRow[];
  if (kFrom || kTo) {
    if (!kFrom || !kTo) throw new Error("--knowledge-from and --knowledge-to go together");
    window = { basis: "knowledge_date", from: kFrom, to: kTo };
    rows = await getRows(`knowledge_at=gte.${kFrom}T00:00:00Z&knowledge_at=lt.${nextDay(kTo)}T00:00:00Z`);
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

  // Recipients and their copies. Every copy is rendered and checked before the first send.
  const recipients: ListRecipient[] = list
    ? await listRecipients()
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

  const outDir = resolve(
    arg("out") ?? join(STATE_DIR, "editions", `${editionDate}${list ? "_list" : ""}${edition.sample ? "_sample" : ""}`),
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

  const empty = edition.mainCount === 0 && edition.underReview.total === 0;
  if (list && empty) {
    console.log(JSON.stringify({ ...summary, sent: 0, skipped_empty: true }, null, 2));
    return;
  }
  if (!flag("send")) {
    console.log(JSON.stringify({ ...summary, sent: false, dry_run: true }, null, 2));
    return;
  }
  if (list && arg("confirm-list-send") !== String(copies.length)) {
    console.error(`refused: a list send needs --confirm-list-send ${copies.length} (the exact recipient count); nothing sent`);
    process.exit(2);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("refused: RESEND_API_KEY is not set; nothing sent");
    process.exit(2);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const logPath = join(outDir, "sent.json");
  const sent = readSentLog(logPath, edition);
  const already = new Set(sent.map((x) => x.to.toLowerCase()));
  const failed: string[] = [];
  const writeLog = () =>
    writeFileSync(
      logPath,
      JSON.stringify(
        { updated_at: new Date().toISOString(), subject, attachment_sha256: edition.attachment.sha256, sent, failed },
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
  writeLog();

  if (!failed.length && flag("advance-cursor") && window.basis === "ledger_seq") {
    writeCursor(cursorPath, window.through_seq, { edition_date: editionDate, sent: sent.length, mode: summary.mode });
  }
  console.log(JSON.stringify({ ...summary, sent: sent.length, failed: failed.length }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("event-ledger-digest failed:", err instanceof Error ? err.message : "unknown_error");
  process.exit(1);
});
