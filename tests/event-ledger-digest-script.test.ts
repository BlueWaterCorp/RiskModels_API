/**
 * scripts/event-ledger-digest.ts run as a process against a local stand-in for Supabase and
 * Resend (127.0.0.1; RESEND_BASE_URL points the SDK at it). No email leaves the machine and no
 * real key is passed: the child env is built from scratch. Ledger rows are the seven real
 * 2026-06-11..15 Form 25 rows of the fixture; HOME is a temp dir, so the cursor and edition
 * folders live there.
 */
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const ROWS = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "event-ledger", "delisting-rows-20260611-20260615.json"), "utf8"),
).rows as { seq: number }[];

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
}
const fake: Fake = { recipients: TWO, failTo: new Set(), ledgerReads: 0, sends: [] };
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
      return send(
        200,
        ROWS.filter((r) => (gt === undefined || r.seq > Number(gt)) && (lte === undefined || r.seq <= Number(lte))),
      );
    }
    if (url.pathname === "/emails" && req.method === "POST") {
      const msg = JSON.parse(await body(req)) as { to: string | string[] };
      const to = Array.isArray(msg.to) ? msg.to[0] : msg.to;
      fake.sends.push(to);
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

function run(h: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((ok) => {
    execFile(
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
        ok({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out: String(stdout), err: String(stderr) }),
    );
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
});
