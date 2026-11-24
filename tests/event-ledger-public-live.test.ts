import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { GET } from "@/app/security-master-feed/latest.json/route";
import { EventLedgerDigestEmail } from "@/emails/event-ledger-digest";
import { buildDigest, EVENT_LEDGER_RSS_URL, renderDigestText, type LedgerRow } from "@/lib/event-ledger-digest";

const rows: LedgerRow[] = JSON.parse(readFileSync(join(__dirname, "fixtures/event-ledger/delisting-rows-20260611-20260615.json"), "utf8")).rows;
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("public Event Ledger export and RSS promotion", () => {
  it("exports only the existing client-safe fields; internal rows remain private", async () => {
    vi.stubEnv("SUPABASE_URL", "http://ledger.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-test-key");
    const internal = structuredClone(rows[0]);
    internal.envelope.license = { basis: null, classification: "internal_only", redistributable: false };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([internal, ...rows.slice(1)])));
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.text();
    const snapshot = JSON.parse(body);
    // The public route serves the dated sample: at most five events, all older than its cutoff.
    expect(snapshot.sample).toBe(true);
    expect(snapshot.count).toBe(5);
    expect(snapshot.events.every((e: { known_date: string }) => e.known_date <= snapshot.sample_through)).toBe(true);
    expect(snapshot.events.map((e: { event_id: string }) => e.event_id)).not.toContain(internal.envelope.event_id);
    expect(body).not.toContain("private-test-key");
    expect(body).not.toContain('"envelope"');
    expect(body).not.toContain('"payload"');
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
  });

  it("fails without publishing an empty success or privileged error detail", async () => {
    vi.stubEnv("SUPABASE_URL", "http://ledger.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("database-secret", { status: 500 })));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database-secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("promotes the same RSS address in HTML and plain-text editions without altering attached data", async () => {
    const edition = buildDigest(rows, { editionDate: "2026-11-23", window: { basis: "ledger_seq", after_seq: 0, through_seq: 5000 }, recentDays: null });
    const before = edition.attachment.body;
    const html = await render(EventLedgerDigestEmail({ edition }));
    expect(html).toContain(`href="${EVENT_LEDGER_RSS_URL}"`);
    expect(renderDigestText(edition)).toContain(EVENT_LEDGER_RSS_URL);
    // An edition links to the page where a subscriber creates a private address, never to a feed address.
    expect(EVENT_LEDGER_RSS_URL).toBe("https://riskmodels.app/security-master-feed/access");
    for (const body of [html, renderDigestText(edition)]) {
      expect(body).not.toContain("feed.xml");
      expect(body).not.toContain("key=");
      expect(body).not.toContain("rmf_");
    }
    expect(edition.attachment.body).toBe(before);
  });
});
