/**
 * scripts/event-ledger-digest.ts run as a process against a local stand-in for Supabase and
 * Resend (127.0.0.1; RESEND_BASE_URL points the SDK at it). No email leaves the machine and no
 * real key is passed: the child env is built from scratch. Ledger rows are the seven real
 * 2026-06-11..15 Form 25 rows of the fixture; HOME is a temp dir, so the cursor and edition
 * folders live there.
 */
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
interface Row {
  seq: number;
  envelope: Record<string, unknown>;
}
const ROWS = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "event-ledger", "delisting-rows-20260611-20260615.json"), "utf8"),
).rows as Row[];

// Recipient rows in the shape feed_waitlist_edition_recipients() returns.
const TWO = [
  { email: "conrad@bwmacro.com", unsubscribe_token: "tok-conrad", purpose: "contact", referral_code: null },
  { email: "team-inbox@example.com", unsubscribe_token: "tok-team", purpose: "feed", referral_code: null },
];

interface Fake {
  recipients: unknown;
  failTo: Set<string>;
  ledgerReads: number;
  sends: string[];
  /** Ledger rows left out of reads (to make a rebuilt edition differ). */
  dropSeq: Set<number>;
  /** Planted rows served after the real ones. */
  extraRows: Row[];
  /** Hold every /emails request open until the test releases it. */
  holdSends: boolean;
  onSend: (() => void) | null;
}
const fake: Fake = {
  recipients: TWO,
  failTo: new Set(),
  ledgerReads: 0,
  sends: [],
  dropSeq: new Set(),
  extraRows: [],
  holdSends: false,
  onSend: null,
};
let server: Server;
let base = "";

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (code: number, v: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (url.pathname === "/rest/v1/rpc/feed_waitlist_edition_recipients") return send(200, fake.recipients);
    if (url.pathname === "/rest/v1/event_ledger") {
      fake.ledgerReads++;
      if (Number(url.searchParams.get("offset") ?? 0) > 0) return send(200, []);
      const gt = (url.search.match(/seq=gt\.(\d+)/) ?? [])[1];
      const lte = (url.search.match(/seq=lte\.(\d+)/) ?? [])[1];
      const all = [...ROWS, ...fake.extraRows];
      // headSeq(): select=seq&order=seq.desc&limit=1.
      if (url.searchParams.get("order") === "seq.desc") {
        return send(200, all.map((r) => ({ seq: r.seq })).sort((a, b) => b.seq - a.seq).slice(0, 1));
      }
      return send(
        200,
        all.filter(
          (r) =>
            !fake.dropSeq.has(r.seq) && (gt === undefined || r.seq > Number(gt)) && (lte === undefined || r.seq <= Number(lte)),
        ),
      );
    }
    if (url.pathname === "/emails" && req.method === "POST") {
      const msg = JSON.parse(await body(req)) as { to: string | string[] };
      const to = Array.isArray(msg.to) ? msg.to[0] : msg.to;
      fake.sends.push(to);
      if (fake.holdSends) {
        fake.onSend?.();
        return; // never answered; the test signals the process
      }
      if (fake.failTo.has(to)) return send(500, { name: "application_error", message: "stand-in failure", statusCode: 500 });
      return send(200, { id: `re_${fake.sends.length}` });
    }
    send(404, {});
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

function home(cursor: Record<string, unknown> = { last_seq: 4597 }): string {
  const h = mkdtempSync(join(tmpdir(), "ledger-home-"));
  const dir = join(h, ".riskmodels", "event-ledger-digest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cursor-list.json"), JSON.stringify(cursor, null, 2) + "\n");
  return h;
}
const stateDir = (h: string) => join(h, ".riskmodels", "event-ledger-digest");
const cursorOf = (h: string) => JSON.parse(readFileSync(join(stateDir(h), "cursor-list.json"), "utf8"));

function run(
  h: string,
  args: string[],
  started?: (child: ReturnType<typeof execFile>) => void,
): Promise<{ code: number; out: string; err: string; signal: string | null }> {
  return new Promise((ok) => {
    const child = execFile(
      // vite-node (a vitest dependency) with the vitest config, for the "@/" alias; tsx is not installed.
      join(ROOT, "node_modules", ".bin", "vite-node"),
      ["-c", "vitest.config.ts", join(ROOT, "scripts", "event-ledger-digest.ts"), ...args],
      {
        cwd: ROOT,
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          HOME: h,
          SUPABASE_URL: base,
          SUPABASE_SERVICE_ROLE_KEY: "stand-in",
          RESEND_API_KEY: "re_stand_in",
          RESEND_BASE_URL: base,
        },
        timeout: 60_000,
      },
      (error, stdout, stderr) =>
        ok({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          out: String(stdout),
          err: String(stderr),
          signal: error ? ((error as { signal?: string | null }).signal ?? null) : null,
        }),
    );
    started?.(child);
  });
}

const SCHEDULED = ["--list", "--send", "--scheduled", "--advance-cursor"];

describe("event-ledger-digest.ts --scheduled (process)", () => {
  it("refuses an empty recipient list and leaves the cursor where it was", async () => {
    fake.recipients = [];
    const h = home();
    const before = readFileSync(join(stateDir(h), "cursor-list.json"), "utf8");
    const r = await run(h, SCHEDULED);
    fake.recipients = TWO;
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("scheduled_no_recipients");
    expect(readFileSync(join(stateDir(h), "cursor-list.json"), "utf8")).toBe(before);
  }, 90_000);

  it("refuses a recipient response that is not a list", async () => {
    fake.recipients = { message: "rpc not found" };
    const h = home();
    const r = await run(h, SCHEDULED);
    fake.recipients = TWO;
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("recipient_list_unreadable");
    expect(cursorOf(h).last_seq).toBe(4597);
  }, 90_000);

  it("refuses without --advance-cursor, with --edition-date and with --out, before reading anything", async () => {
    const reads = fake.ledgerReads;
    const h = home();
    const cases: [string[], string][] = [
      [["--list", "--send", "--scheduled"], "scheduled_needs_advance_cursor"],
      [[...SCHEDULED, "--edition-date", "2026-11-16"], "scheduled_cursor_only"],
      [[...SCHEDULED, "--out", join(h, "elsewhere")], "scheduled_fixed_state"],
    ];
    for (const [args, reason] of cases) {
      const r = await run(h, args);
      expect(r.code).toBe(2);
      expect(r.err).toContain(reason);
    }
    expect(fake.ledgerReads).toBe(reads);
  }, 90_000);

  it("refuses while another run holds the send lock, and sends nothing", async () => {
    const h = home();
    writeFileSync(join(stateDir(h), "list-send.lock"), JSON.stringify({ pid: 99999, started_at: new Date().toISOString() }));
    const sends = fake.sends.length;
    const r = await run(h, SCHEDULED);
    expect(r.code).toBe(5);
    expect(r.err).toContain("locked");
    expect(fake.sends.length).toBe(sends);
    expect(existsSync(join(stateDir(h), "list-send.lock"))).toBe(true);
  }, 90_000);

  it("after a partial send, refuses the next day's run and resumes only the address that failed", async () => {
    const h = home();
    fake.failTo = new Set(["team-inbox@example.com"]);
    const sends = fake.sends.length;
    const day1 = await run(h, SCHEDULED);
    fake.failTo = new Set();
    expect(day1.code).toBe(1);
    expect(fake.sends.slice(sends).sort()).toEqual(["conrad@bwmacro.com", "team-inbox@example.com"]);
    const c1 = cursorOf(h);
    expect(c1.last_seq).toBe(4597);
    expect(c1.pending_send).toMatchObject({ after_seq: 4597, through_seq: 4604 });
    expect(existsSync(join(stateDir(h), "list-send.lock"))).toBe(false);

    // Next day: the scheduled run must not send the window again to everyone.
    const mark = fake.sends.length;
    const day2 = await run(h, SCHEDULED);
    expect(day2.code).toBe(4);
    expect(day2.err).toContain("pending_partial_send");
    expect(fake.sends.length).toBe(mark);
    expect(cursorOf(h)).toEqual(c1);

    // Resume: the same edition, only the address that failed, then the cursor moves.
    const resume = await run(h, ["--list", "--send", "--resume-pending", "--confirm-list-send", "2"]);
    expect(resume.code).toBe(0);
    expect(fake.sends.slice(mark)).toEqual(["team-inbox@example.com"]);
    const c2 = cursorOf(h);
    expect(c2.last_seq).toBe(4604);
    expect(c2.pending_send ?? null).toBeNull();
    const folder = readdirSync(join(stateDir(h), "editions")).find((d) => d.endsWith("_list"))!;
    const log = JSON.parse(readFileSync(join(stateDir(h), "editions", folder, "sent.json"), "utf8"));
    expect(log.complete).toBe(true);
    expect(log.sent.map((s: { to: string }) => s.to).sort()).toEqual(["conrad@bwmacro.com", "team-inbox@example.com"]);
  }, 180_000);

  it("resumes by address even when the rebuilt edition differs, and says so", async () => {
    const h = home();
    fake.failTo = new Set(["team-inbox@example.com"]);
    // An ad-hoc list send dated 2026-07-11, so the seven June rows are listed and attached
    // (a scheduled run dated today would only count them as older, with an empty attachment).
    const day1 = await run(h, [
      "--list", "--send", "--advance-cursor", "--confirm-list-send", "2", "--edition-date", "2026-07-11",
    ]);
    fake.failTo = new Set();
    expect(day1.code).toBe(1);
    const pending = cursorOf(h).pending_send;
    expect(pending.edition_date).toBe("2026-07-11");
    expect(pending.out_dir).toMatch(/_list$/);
    expect(pending.attachment_sha256).toMatch(/^[0-9a-f]{64}$/);

    // One row of the window no longer comes back, so the rebuilt attachment differs.
    fake.dropSeq = new Set([4600]);
    const mark = fake.sends.length;
    const resume = await run(h, ["--list", "--send", "--resume-pending", "--confirm-list-send", "2"]);
    fake.dropSeq = new Set();
    expect(resume.code).toBe(0);
    expect(fake.sends.slice(mark)).toEqual(["team-inbox@example.com"]);
    expect(resume.err + resume.out).toContain("resume_sha_mismatch");
    expect(cursorOf(h).last_seq).toBe(4604);
  }, 180_000);

  it("refuses --resume-pending with --out, --cursor or review settings", async () => {
    const h = home({ last_seq: 4597 });
    for (const extra of [["--out", join(h, "x")], ["--cursor", join(h, "c.json")], ["--no-under-review"], ["--review-cap", "3"]]) {
      const r = await run(h, ["--list", "--send", "--resume-pending", "--confirm-list-send", "2", ...extra]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("resume_takes_pending_window");
    }
  }, 90_000);

  it("releases the lock and exits non-zero on SIGTERM mid-send, leaving the send pending", async () => {
    const h = home();
    fake.holdSends = true;
    let child: ReturnType<typeof execFile> | null = null;
    fake.onSend = () => child?.kill("SIGTERM");
    const r = await run(h, SCHEDULED, (c) => (child = c));
    fake.holdSends = false;
    fake.onSend = null;
    expect(r.code !== 0 || r.signal !== null).toBe(true);
    expect(r.code).toBe(143);
    expect(existsSync(join(stateDir(h), "list-send.lock"))).toBe(false);
    expect(cursorOf(h).pending_send).toMatchObject({ after_seq: 4597, through_seq: 4604 });
  }, 90_000);

  it("refuses --out on an ad-hoc list send, before reading anything", async () => {
    const h = home();
    const reads = fake.ledgerReads;
    const r = await run(h, ["--list", "--send", "--confirm-list-send", "2", "--out", join(h, "elsewhere")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("list_send_fixed_state");
    expect(fake.ledgerReads).toBe(reads);
  }, 90_000);

  it("resumes from the edition folder recorded in pending_send, not a recomputed one", async () => {
    const h = home();
    fake.failTo = new Set(["team-inbox@example.com"]);
    const day1 = await run(h, SCHEDULED);
    fake.failTo = new Set();
    expect(day1.code).toBe(1);
    // Move the edition folder (as a pre-fix custom --out would have placed it elsewhere) and
    // point pending_send at the new place.
    const c = cursorOf(h);
    const moved = join(h, "moved_edition");
    renameSync(c.pending_send.out_dir, moved);
    c.pending_send.out_dir = moved;
    writeFileSync(join(stateDir(h), "cursor-list.json"), JSON.stringify(c, null, 2) + "\n");
    const mark = fake.sends.length;
    const resume = await run(h, ["--list", "--send", "--resume-pending", "--confirm-list-send", "2"]);
    expect(resume.code).toBe(0);
    expect(fake.sends.slice(mark)).toEqual(["team-inbox@example.com"]);
    const log = JSON.parse(readFileSync(join(moved, "sent.json"), "utf8"));
    expect(log.complete).toBe(true);
  }, 180_000);

  it("flood guard: refuses a list edition over the main-section cap, sends nothing, keeps the cursor", async () => {
    // Dated 2026-07-11 so the seven real June rows are listed: main section 7, cap lowered to 5.
    const h = home();
    const adhoc = ["--list", "--send", "--advance-cursor", "--confirm-list-send", "2", "--edition-date", "2026-07-11"];
    const before = readFileSync(join(stateDir(h), "cursor-list.json"), "utf8");
    const sends = fake.sends.length;
    const over = await run(h, [...adhoc, "--main-cap", "5"]);
    expect(over.code).toBe(6);
    expect(over.err).toContain("main_section_over_cap");
    expect(over.err).toContain("--confirm-main-count 7");
    expect(over.err).toContain("--init-cursor --list");
    const wrong = await run(h, [...adhoc, "--main-cap", "5", "--confirm-main-count", "6"]);
    expect(wrong.code).toBe(6);
    expect(wrong.err).toContain("confirm_main_count_mismatch");
    expect(fake.sends.length).toBe(sends);
    expect(readFileSync(join(stateDir(h), "cursor-list.json"), "utf8")).toBe(before);

    const ok = await run(h, [...adhoc, "--main-cap", "5", "--confirm-main-count", "7"]);
    expect(ok.code).toBe(0);
    expect(fake.sends.slice(sends).sort()).toEqual(["conrad@bwmacro.com", "team-inbox@example.com"]);
    expect(cursorOf(h).last_seq).toBe(4604);
  }, 180_000);

  it("flood guard holds in a scheduled run: a correction is always listed, so it counts", async () => {
    // A planted correction of a real row (corrections are listed however old the event).
    const corr = JSON.parse(JSON.stringify(ROWS[0])) as Row;
    corr.seq = 4605;
    corr.envelope.event_id = "0b1e5c55-2c43-5c6e-9d0a-5d2c1a9e7f02";
    corr.envelope.supersedes_event_id = ROWS[0].envelope.event_id;
    corr.envelope.correction_reason = "remapped by edgar_delisting 1.2.0";
    fake.extraRows = [corr];
    const h = home();
    const sends = fake.sends.length;
    const r = await run(h, [...SCHEDULED, "--main-cap", "0"]);
    fake.extraRows = [];
    expect(r.code).toBe(6);
    expect(r.err).toContain("main_section_over_cap");
    expect(fake.sends.length).toBe(sends);
    expect(cursorOf(h)).toEqual({ last_seq: 4597 });
  }, 90_000);

  it("refuses a --main-cap above the cap, before reading anything", async () => {
    const h = home();
    const reads = fake.ledgerReads;
    const r = await run(h, [...SCHEDULED, "--main-cap", "51"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--main-cap");
    expect(fake.ledgerReads).toBe(reads);
  }, 90_000);

  it("--init-cursor --list parks the list cursor at the ledger head without sending", async () => {
    const h = home();
    const sends = fake.sends.length;
    const r = await run(h, ["--init-cursor", "--list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("cursor initialised at seq 4604 (was 4597; positions 4598..4604 skipped, nothing sent)");
    expect(cursorOf(h)).toMatchObject({ last_seq: 4604, previous_seq: 4597 });
    expect(fake.sends.length).toBe(sends);
    expect(existsSync(join(stateDir(h), "list-send.lock"))).toBe(false);
    // The next scheduled run then has nothing to send.
    const next = await run(h, SCHEDULED);
    expect(next.code).toBe(0);
    expect(JSON.parse(next.out)).toMatchObject({ rows_read: 0, skipped_empty: true });
    expect(fake.sends.length).toBe(sends);
  }, 90_000);

  it("--init-cursor --list refuses while a list send is pending, or the lock is held", async () => {
    const pending = { edition_date: "2026-11-19", after_seq: 4597, through_seq: 4604, started_at: "2026-11-20T14:00:00Z" };
    const h = home({ last_seq: 4597, pending_send: pending });
    const r = await run(h, ["--init-cursor", "--list"]);
    expect(r.code).toBe(4);
    expect(r.err).toContain("pending_partial_send");
    expect(cursorOf(h)).toEqual({ last_seq: 4597, pending_send: pending });
    const h2 = home();
    writeFileSync(join(stateDir(h2), "list-send.lock"), JSON.stringify({ pid: 99999, started_at: new Date().toISOString() }));
    const locked = await run(h2, ["--init-cursor", "--list"]);
    expect(locked.code).toBe(5);
    expect(cursorOf(h2)).toEqual({ last_seq: 4597 });
  }, 90_000);
});
