/**
 * Public sample vs subscriber feed.
 *
 * States these tests exist to catch:
 *  - the public export carries a current event (the full export is still open);
 *  - a private route answers without a credential, or with one the database refuses;
 *  - a withdrawn or corrected event keeps showing its unflagged original, or changes event id;
 *  - a credential appears in a log line, a response body or a cacheable response.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerRow } from "@/lib/event-ledger-digest";
import {
  PUBLIC_SAMPLE_COUNT,
  buildPublicLatest,
  buildPublicSample,
  loadLedgerExports,
  sampleCutoff,
} from "@/lib/event-ledger-public";
import { eventLedgerRss, eventRssGuid } from "@/lib/event-ledger-rss";
import { FEED_KEY_RE, checkFeedKey, hashFeedKey, newFeedKey, readFeedKey } from "@/lib/feed-access";

const ROWS: LedgerRow[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures/event-ledger/delisting-rows-20260611-20260615.json"), "utf8"),
).rows;
const clone = (r: LedgerRow): LedgerRow => JSON.parse(JSON.stringify(r));
/** A copy of a real row with a new id, made publicly known on `date`. */
function knownOn(base: LedgerRow, date: string, n: number): LedgerRow {
  const r = clone(base);
  r.seq = 90000 + n;
  r.envelope.event_id = `a0c0ffee-0000-5000-8000-${String(n).padStart(12, "0")}`;
  (r.envelope as unknown as Record<string, unknown>).dedupe_key = String(n).padStart(64, "0");
  r.envelope.knowledge_at = `${date}T15:00:00+00:00`;
  return r;
}

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: true as unknown, error: null as unknown }));
const rateLimit = vi.fn();
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import { GET as publicJson } from "@/app/security-master-feed/latest.json/route";
import { GET as privateJson } from "@/app/security-master-feed/private/latest.json/route";
import { GET as privateRss } from "@/app/security-master-feed/private/feed.xml/route";

const GENERATED = "2026-06-20T18:00:00Z"; // cutoff 2026-06-13: two fixture days before it, one after

describe("the dated public sample", () => {
  it("holds only events publicly known on or before the cutoff, and says which date that is", () => {
    const file = buildPublicSample(ROWS, { generatedAt: GENERATED });
    expect(sampleCutoff(GENERATED)).toBe("2026-06-13");
    expect(file.sample).toBe(true);
    expect(file.sample_through).toBe("2026-06-13");
    expect(file.sample_note).toContain("2026-06-13");
    expect(file.count).toBe(4);
    expect(file.events.every((e) => e.known_date! <= "2026-06-13")).toBe(true);
    // The subscriber file from the same rows does carry the newer ones.
    const full = buildPublicLatest(ROWS, { generatedAt: GENERATED });
    expect(full.count).toBe(7);
    expect(full.events.some((e) => e.known_date! > "2026-06-13")).toBe(true);
  });

  it("is capped, newest first", () => {
    const many = Array.from({ length: 12 }, (_, i) => knownOn(ROWS[0], "2026-06-10", i + 1));
    const file = buildPublicSample([...ROWS, ...many], { generatedAt: GENERATED });
    expect(file.count).toBe(PUBLIC_SAMPLE_COUNT);
    expect(file.events).toHaveLength(PUBLIC_SAMPLE_COUNT);
    const known = file.events.map((e) => e.known_date!);
    expect([...known].sort().reverse()).toEqual(known);
  });

  it("leaves out an event whose known date is missing: it cannot be shown to be old", () => {
    const undated = knownOn(ROWS[0], "2026-06-10", 1);
    undated.envelope.knowledge_at = null as unknown as string;
    const file = buildPublicSample([undated], { generatedAt: GENERATED });
    expect(file.events).toHaveLength(0);
  });

  it("is empty, not padded with newer events, when nothing is old enough", () => {
    const file = buildPublicSample(ROWS, { generatedAt: "2026-06-12T00:00:00Z" });
    expect(file.count).toBe(0);
    expect(file.latest_known_date).toBeNull();
  });

  it("keeps the export's schema string and field names, so the existing page and feed can read it", () => {
    const sample = buildPublicSample(ROWS, { generatedAt: GENERATED });
    const full = buildPublicLatest(ROWS, { generatedAt: GENERATED });
    expect(sample.schema).toBe(full.schema);
    expect(Object.keys(sample.events[0]!)).toEqual(Object.keys(full.events[0]!));
    for (const k of Object.keys(full)) expect(sample).toHaveProperty(k);
  });
});

describe("corrections and withdrawals", () => {
  // ROWS[0] became known 2026-06-11, inside the sample window.
  const withdrawal = (date: string) => {
    const wd = knownOn(ROWS[1], date, 77);
    wd.envelope.lifecycle_status = "rejected";
    wd.envelope.supersedes_event_id = ROWS[0].envelope.event_id;
    wd.envelope.correction_reason = "filing withdrawn";
    return wd;
  };

  it("drops a sampled original once it is withdrawn, even when the withdrawal is newer than the cutoff", () => {
    const before = buildPublicSample(ROWS, { generatedAt: GENERATED });
    expect(before.events.map((e) => e.event_id)).toContain(ROWS[0].envelope.event_id);
    const wd = withdrawal("2026-06-19");
    const after = buildPublicSample([...ROWS, wd], { generatedAt: GENERATED });
    const ids = after.events.map((e) => e.event_id);
    expect(ids).not.toContain(ROWS[0].envelope.event_id);
    expect(ids).not.toContain(wd.envelope.event_id); // newer than the cutoff: subscribers only
    const full = buildPublicLatest([...ROWS, wd], { generatedAt: GENERATED });
    expect(full.events.map((e) => e.event_id)).not.toContain(ROWS[0].envelope.event_id);
    expect(full.events.find((e) => e.event_id === wd.envelope.event_id)?.flag).toBeTruthy();
  });

  it("shows an old-enough withdrawal flagged, under its own event id, in the sample and the subscriber feed", () => {
    const wd = withdrawal("2026-06-12");
    for (const file of [
      buildPublicSample([...ROWS, wd], { generatedAt: GENERATED }),
      buildPublicLatest([...ROWS, wd], { generatedAt: GENERATED }),
    ]) {
      const shown = file.events.find((e) => e.event_id === wd.envelope.event_id)!;
      expect(shown.status).toBe("rejected");
      expect(shown.flag).toContain("filing withdrawn");
      expect(file.events.map((e) => e.event_id)).not.toContain(ROWS[0].envelope.event_id);
    }
  });

  it("gives an event the same RSS id in both files, unchanged by a refresh, and a new one when it is revised", () => {
    const sample = buildPublicSample(ROWS, { generatedAt: GENERATED });
    const full = buildPublicLatest(ROWS, { generatedAt: GENERATED });
    const later = buildPublicLatest(ROWS, { generatedAt: "2026-06-21T18:00:00Z" });
    const id = sample.events[0]!.event_id;
    const pick = (f: { events: { event_id: string }[] }) => f.events.find((e) => e.event_id === id)! as never;
    expect(eventRssGuid(pick(sample))).toBe(eventRssGuid(pick(full)));
    expect(eventRssGuid(pick(full))).toBe(eventRssGuid(pick(later)));
    expect(eventRssGuid(pick(full))).toMatch(new RegExp(`^event:${id}:[0-9a-f]{16}$`));
    // The same event id, withdrawn: the id is kept and the revision part changes.
    const revised = clone(ROWS.find((r) => r.envelope.event_id === id)!);
    revised.envelope.lifecycle_status = "rejected";
    revised.envelope.correction_reason = "filing withdrawn";
    const after = buildPublicLatest([revised], { generatedAt: GENERATED }).events[0]!;
    expect(after.event_id).toBe(id);
    expect(eventRssGuid(after)).not.toBe(eventRssGuid(pick(full)));
    expect(eventRssGuid(after).startsWith(`event:${id}:`)).toBe(true);
  });

  it("renders a withdrawal in the subscriber RSS with its title prefix, filing link and separate date bases", () => {
    const wd = withdrawal("2026-06-12");
    const xml = eventLedgerRss(buildPublicLatest([...ROWS, wd], { generatedAt: GENERATED }), {
      title: "t", description: "d", link: "https://riskmodels.app/security-master-feed",
      itemFallbackLink: "https://riskmodels.app/security-master-feed",
    });
    expect(xml).toContain("<title>Withdrawn: ");
    expect(xml).toContain("Known date: 2026-06-12 (");
    expect(xml).toContain("Event date: ");
    expect(xml).toContain("https://www.sec.gov/");
    expect(xml).not.toContain("atom:link"); // a private feed never prints its own address
  });
});

describe("one ledger read builds both files", () => {
  it("reads the ledger once and separates current events from the sample", async () => {
    const queries: string[] = [];
    const out = await loadLedgerExports(async (q) => { queries.push(q); return ROWS; }, { generatedAt: GENERATED });
    expect(queries).toHaveLength(2);
    expect(out.subscriber.count).toBe(7);
    expect(out.sample.count).toBe(4);
    expect((out.subscriber as unknown as Record<string, unknown>).sample).toBeUndefined();
  });
});

describe("feed credentials", () => {
  it("are random, prefixed, and stored only as a sha256", () => {
    const a = newFeedKey();
    const b = newFeedKey();
    expect(a.key).toMatch(FEED_KEY_RE);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashFeedKey(a.key));
    expect(a.hash).not.toContain(a.key.slice(4, 20));
  });

  it("are read from the Authorization header or ?key=, and nothing else shaped differently", () => {
    const { key } = newFeedKey();
    const url = "https://riskmodels.app/security-master-feed/private/feed.xml";
    expect(readFeedKey(new Request(url, { headers: { authorization: `Bearer ${key}` } }))).toBe(key);
    expect(readFeedKey(new Request(`${url}?key=${key}`))).toBe(key);
    expect(readFeedKey(new Request(url))).toBeNull();
    expect(readFeedKey(new Request(`${url}?key=rm_agent_live_abcdef`))).toBeNull(); // an API key is not a feed credential
    expect(readFeedKey(new Request(`${url}?key=3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f`))).toBeNull(); // nor an unsubscribe token
    expect(readFeedKey(new Request(`${url}?token=${key}`))).toBeNull();
  });

  it("ask the database by hash, and treat anything but true as refused", async () => {
    const { key, hash } = newFeedKey();
    const call = vi.fn(async () => ({ data: true as unknown, error: null as unknown }));
    expect(await checkFeedKey({ rpc: call }, key)).toBe("ok");
    expect(call).toHaveBeenCalledWith("feed_access_check", { p_token_hash: hash });
    for (const data of [false, null, "true", 1]) {
      expect(await checkFeedKey({ rpc: async () => ({ data, error: null }) }, key)).toBe("denied");
    }
    expect(await checkFeedKey({ rpc: async () => ({ data: true, error: { code: "XX000" } }) }, key)).toBe("unavailable");
    expect(await checkFeedKey({ rpc: async () => { throw new Error("down"); } }, key)).toBe("unavailable");
    const none = vi.fn();
    expect(await checkFeedKey({ rpc: none }, null)).toBe("denied");
    expect(none).not.toHaveBeenCalled();
  });
});

describe("routes", () => {
  const { key } = newFeedKey();
  const BASE = "https://riskmodels.app/security-master-feed/private";
  let current: LedgerRow;
  let fetchMock: ReturnType<typeof vi.fn>;
  let logs: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "http://ledger.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-test-key");
    // One event known yesterday: current, so it belongs to subscribers only.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    current = knownOn(ROWS[0], yesterday, 500);
    fetchMock = vi.fn().mockImplementation(async () => Response.json([...ROWS, current]));
    vi.stubGlobal("fetch", fetchMock);
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 299, retryAfter: 3600 });
    logs = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const l of logs) l.mockRestore();
  });

  it("public latest.json is the sample: it never carries a current event", async () => {
    const res = await publicJson();
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.sample).toBe(true);
    expect(body.count).toBeLessThanOrEqual(PUBLIC_SAMPLE_COUNT);
    expect(text).not.toContain(current.envelope.event_id);
    expect(body.events.every((e: { known_date: string }) => e.known_date <= body.sample_through)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  for (const [name, GET, path] of [
    ["feed.xml", privateRss, "feed.xml"],
    ["latest.json", privateJson, "latest.json"],
  ] as const) {
    describe(`private ${name}`, () => {
      it("refuses a request with no credential, without reading the ledger or asking the database", async () => {
        const res = await GET(new Request(`${BASE}/${path}`));
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toContain("Bearer");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(await res.text()).not.toContain(current.envelope.event_id);
        expect(rpc).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("refuses a well-formed credential the database does not accept (pending, rejected, revoked, unsubscribed)", async () => {
        rpc.mockResolvedValue({ data: false, error: null });
        const res = await GET(new Request(`${BASE}/${path}?key=${key}`));
        expect(res.status).toBe(401);
        expect(rpc).toHaveBeenCalledWith("feed_access_check", { p_token_hash: hashFeedKey(key) });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await res.text()).not.toContain(current.envelope.event_id);
      });

      it("refuses another kind of secret presented as the key", async () => {
        for (const other of ["3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f", "A".repeat(43), "rm_agent_live_" + "a".repeat(40)]) {
          expect((await GET(new Request(`${BASE}/${path}?key=${other}`))).status).toBe(401);
        }
        expect(rpc).not.toHaveBeenCalled();
      });

      it("serves current events to an accepted credential, by query or header, uncacheable and unindexed", async () => {
        for (const req of [
          new Request(`${BASE}/${path}?key=${key}`),
          new Request(`${BASE}/${path}`, { headers: { authorization: `Bearer ${key}` } }),
        ]) {
          const res = await GET(req);
          expect(res.status).toBe(200);
          const text = await res.text();
          expect(text).toContain(current.envelope.event_id);
          expect(text).not.toContain(key);
          expect(text).not.toContain("private-test-key");
          expect(res.headers.get("cache-control")).toBe("private, no-store");
          expect(res.headers.get("referrer-policy")).toBe("no-referrer");
          expect(res.headers.get("x-robots-tag")).toContain("noindex");
        }
      });

      it("stops serving the moment the database refuses the same credential (revocation, unsubscribe)", async () => {
        expect((await GET(new Request(`${BASE}/${path}?key=${key}`))).status).toBe(200);
        rpc.mockResolvedValue({ data: false, error: null });
        expect((await GET(new Request(`${BASE}/${path}?key=${key}`))).status).toBe(401);
      });

      it("answers 503, never content, when the check or the ledger cannot be read", async () => {
        rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "down" } });
        expect((await GET(new Request(`${BASE}/${path}?key=${key}`))).status).toBe(503);
        rpc.mockResolvedValue({ data: true, error: null });
        fetchMock.mockResolvedValue(new Response("database-secret", { status: 500 }));
        const res = await GET(new Request(`${BASE}/${path}?key=${key}`));
        expect(res.status).toBe(503);
        expect(await res.text()).not.toContain("database-secret");
      });

      it("is rate limited before anything else", async () => {
        rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 120 });
        const res = await GET(new Request(`${BASE}/${path}?key=${key}`));
        expect(res.status).toBe(429);
        expect(rpc).not.toHaveBeenCalled();
      });

      it("never writes the credential or the request URL to a log", async () => {
        rpc.mockResolvedValueOnce({ data: true, error: null })
          .mockResolvedValueOnce({ data: false, error: null })
          .mockResolvedValueOnce({ data: null, error: { code: "XX000", message: `bad ${key}` } });
        for (let i = 0; i < 3; i++) await GET(new Request(`${BASE}/${path}?key=${key}`));
        const written = JSON.stringify(logs.flatMap((l) => l.mock.calls));
        expect(written).not.toContain(key);
        expect(written).not.toContain(hashFeedKey(key));
      });
    });
  }

  it("the subscriber RSS and JSON carry the same events, with GUIDs built from the event id", async () => {
    const json = JSON.parse(await (await privateJson(new Request(`${BASE}/latest.json?key=${key}`))).text());
    const xml = await (await privateRss(new Request(`${BASE}/feed.xml?key=${key}`))).text();
    expect(json.count).toBe(8);
    for (const e of json.events) expect(xml).toContain(eventRssGuid(e));
    expect(xml).not.toContain("feed.xml?key");
  });
});
