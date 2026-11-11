/**
 * Daily Event Ledger edition: read new events from public.event_ledger, build
 * the email (HTML, plain text, attached events_<date>.jsonl) and, with --send,
 * send it to the one allowed recipient with the gws CLI.
 *
 * Daily run (what the disabled schedule in scripts/event-ledger-digest.launchd.plist runs):
 *   doppler run --project erm3 --config prd -- \
 *     npx tsx scripts/event-ledger-digest.ts --send --advance-cursor
 *
 * First run only, to start from the current head of the ledger instead of
 * mailing its whole history:
 *   doppler run --project erm3 --config prd -- npx tsx scripts/event-ledger-digest.ts --init-cursor
 *
 * Review sample by knowledge date (does not read or move the cursor):
 *   ... npx tsx scripts/event-ledger-digest.ts --knowledge-from 2026-06-11 --knowledge-to 2026-06-15 \
 *     --edition-date 2026-11-10 --sample --sample-note "..." [--send]
 *
 * Sections: "Under review, not verified" is on by default (INCLUDE_UNDER_REVIEW_DEFAULT in
 * lib/event-ledger-digest.ts); --no-under-review leaves it out for one run. --internal builds an
 * internal edition that also lists internal_only rows under "Internal only, not for clients";
 * it is refused unless the recipient is in INTERNAL_RECIPIENTS. Each review section shows at most
 * --review-cap rows (default 20) and counts the rest. --sample-label sets the subject prefix.
 *
 * Window: by default every event with ledger seq above the cursor (the seq of
 * the last edition sent). --since-seq N overrides the cursor for one run.
 * Without --send nothing is sent: the files are written to --out and the paths
 * printed. The cursor moves only after a successful send with --advance-cursor.
 *
 * Reads only: one paged GET per 1000 rows against the service-role-only table.
 * Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Turning the schedule on (Conrad's decision; it is off):
 *   1. --init-cursor once (above), so the first edition starts at the ledger head.
 *   2. In scripts/event-ledger-digest.launchd.plist set Disabled to false, copy it to
 *      ~/Library/LaunchAgents/app.riskmodels.event-ledger-digest.plist and run
 *        launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.riskmodels.event-ledger-digest.plist
 *      Off again: launchctl bootout gui/$(id -u)/app.riskmodels.event-ledger-digest
 *   A LaunchAgent runs in the user session, so gws can read its keychain token; cron cannot.
 *   Log: ~/Library/Logs/event-ledger-digest.log.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { render } from "@react-email/render";
import { EventLedgerDigestEmail } from "../emails/event-ledger-digest";
import {
  ATTACHMENT_MEDIA_TYPE,
  INTERNAL_RECIPIENTS,
  buildDigest,
  digestSubject,
  renderDigestText,
  restrictedWordHits,
  type DigestWindow,
  type LedgerRow,
} from "../lib/event-ledger-digest";
import { buildMimeMessage } from "../lib/event-ledger-digest-mime";

/** The only address an edition may go to until Conrad approves a recipient list. */
const ALLOWED_RECIPIENTS = ["conrad@bwmacro.com"] as const;

const STATE_DIR = join(homedir(), ".riskmodels", "event-ledger-digest");
const DEFAULT_CURSOR = join(STATE_DIR, "cursor.json");

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

async function getRows(query: string): Promise<LedgerRow[]> {
  const { url, key } = env();
  const rows: LedgerRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/rest/v1/event_ledger?select=seq,published_at,envelope&${query}&order=seq.asc&limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`event_ledger_read_failed_${res.status}`);
    const page = (await res.json()) as LedgerRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function headSeq(): Promise<number> {
  const { url, key } = env();
  const res = await fetch(`${url}/rest/v1/event_ledger?select=seq&order=seq.desc&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`event_ledger_read_failed_${res.status}`);
  const rows = (await res.json()) as { seq: number }[];
  return rows[0]?.seq ?? 0;
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

async function main() {
  const cursorPath = arg("cursor") ?? DEFAULT_CURSOR;

  if (flag("init-cursor")) {
    const head = await headSeq();
    writeCursor(cursorPath, head, { note: "initialised at ledger head; no edition sent" });
    console.log(`cursor initialised at seq ${head}: ${cursorPath}`);
    return;
  }

  const to = arg("to") ?? ALLOWED_RECIPIENTS[0];
  if (!(ALLOWED_RECIPIENTS as readonly string[]).includes(to)) {
    console.error("refused: recipient is not on the allowed list");
    process.exit(2);
  }
  const audience = flag("internal") ? "internal" : "client";
  if (audience === "internal" && !INTERNAL_RECIPIENTS.includes(to)) {
    console.error("refused: an internal edition may go only to an internal recipient");
    process.exit(2);
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
      console.error(`no cursor at ${cursorPath}; run once with --init-cursor, or pass --since-seq N`);
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
    recipient: to,
    reviewCap: arg("review-cap") !== undefined ? Number(arg("review-cap")) : undefined,
  });
  const html = await render(EventLedgerDigestEmail({ edition }));
  const text = renderDigestText(edition);
  const subject = digestSubject(edition);

  const hits = restrictedWordHits(html, text, edition.attachment.body);
  if (hits.length) {
    console.error(`refused: rendered edition contains restricted words (${hits.length} patterns); nothing sent`);
    process.exit(3);
  }

  const outDir = resolve(arg("out") ?? join(STATE_DIR, "editions", `${editionDate}${edition.sample ? "_sample" : ""}`));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "edition.html"), html);
  writeFileSync(join(outDir, "edition.txt"), text);
  writeFileSync(join(outDir, edition.attachment.filename), edition.attachment.body);
  const eml = buildMimeMessage({
    to,
    subject,
    text,
    html,
    attachment: { filename: edition.attachment.filename, contentType: ATTACHMENT_MEDIA_TYPE, body: edition.attachment.body },
  });
  writeFileSync(join(outDir, "message.eml"), eml);

  const summary = {
    subject,
    window,
    rows_read: rows.length,
    main: edition.mainCount,
    corrections: edition.correctionCount,
    audience,
    under_review: { shown: edition.underReview.items.length, total: edition.underReview.total },
    internal_only: { shown: edition.internalOnly.items.length, total: edition.internalOnly.total },
    withheld: edition.withheld,
    families: Object.fromEntries(edition.families.map((f) => [f.label, f.items.length])),
    attachment: { filename: edition.attachment.filename, lines: edition.attachment.lines, sha256: edition.attachment.sha256 },
    out: outDir,
  };

  if (!flag("send")) {
    console.log(JSON.stringify({ ...summary, sent: false }, null, 2));
    return;
  }

  // gws sends the message bytes as built; the Gmail connector would rewrite the links.
  const out = execFileSync(
    "gws",
    [
      "gmail",
      "users",
      "messages",
      "send",
      "--params",
      JSON.stringify({ userId: "me" }),
      "--upload",
      "message.eml",
      "--upload-content-type",
      "message/rfc822",
    ],
    { cwd: outDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const sent = JSON.parse(out) as { id?: string };
  if (!sent.id) throw new Error("send_failed_no_message_id");
  writeFileSync(join(outDir, "sent.json"), JSON.stringify({ message_id: sent.id, sent_at: new Date().toISOString(), subject }, null, 2) + "\n");

  if (flag("advance-cursor") && window.basis === "ledger_seq") {
    writeCursor(cursorPath, window.through_seq, { message_id: sent.id, edition_date: editionDate });
  }
  console.log(JSON.stringify({ ...summary, sent: true, message_id: sent.id }, null, 2));
}

main().catch((err) => {
  console.error("event-ledger-digest failed:", err instanceof Error ? err.message : "unknown_error");
  process.exit(1);
});
