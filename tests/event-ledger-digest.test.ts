import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { EventLedgerDigestEmail } from "@/emails/event-ledger-digest";
import {
  ENVELOPE_REQUIRED_FIELDS,
  FEED_TERMS_URL,
  GDELT_CREDIT,
  allowListViolations,
  editionFooter,
  internalFooter,
  priceOrCapHits,
  valueViolations,
  licenseLabel,
  marketCapHits,
  INCLUDE_UNDER_REVIEW_DEFAULT,
  INTERNAL_ONLY_HEADING,
  InternalRecipientError,
  buildDigest,
  buildDigestDescriptor,
  canonicalJson,
  digestSubject,
  provisionLabel,
  renderDigestText,
  restrictedWordHits,
  type LedgerRow,
} from "@/lib/event-ledger-digest";
import { buildMimeMessage } from "@/lib/event-ledger-digest-mime";
import { PUBLIC_LATEST_QUERIES, buildPublicLatest, loadPublicLatest } from "@/lib/event-ledger-public";

// Seven real production rows (Form 25 delistings, knowledge dates 2026-06-11..15) and the
// bytes ERM3's contract.to_json produces for them. Variants below change one field of a real row.
const FIX = join(__dirname, "fixtures", "event-ledger");
const ROWS: LedgerRow[] = JSON.parse(readFileSync(join(FIX, "delisting-rows-20260611-20260615.json"), "utf8")).rows;
const PY_JSONL = readFileSync(join(FIX, "delisting-rows-20260611-20260615.contract-to_json.jsonl"), "utf8");

const WINDOW = { basis: "knowledge_date", from: "2026-06-11", to: "2026-06-15" } as const;
const build = (rows: LedgerRow[] = ROWS, extra: Partial<Parameters<typeof buildDigest>[1]> = {}) =>
  buildDigest(rows, { editionDate: "2026-11-10", window: WINDOW, ...extra });

const clone = (r: LedgerRow): LedgerRow => JSON.parse(JSON.stringify(r));

// Same list as tests/feed-email.test.ts, stored reversed so the words never appear in the repo.
const FORBIDDEN = ["pisuc", "nisi", "tesTcaf", "dhdoe", "grebmoolb", "vitinifer", "arrab", "amoixa", "icsm"].map(
  (w) => new RegExp(`\\b${w.split("").reverse().join("")}\\b`, "i"),
);

function unescapeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function descriptorFrom(raw: string): Record<string, unknown> {
  const body = unescapeHtml(raw);
  const start = body.indexOf('"schema": "riskmodels.event-ledger-digest/1"');
  expect(start).toBeGreaterThan(-1);
  const open = body.lastIndexOf("{", start);
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "{") depth++;
    if (body[i] === "}" && --depth === 0) return JSON.parse(body.slice(open, i + 1));
  }
  throw new Error("descriptor not closed");
}

describe("event ledger digest", () => {
  it("groups the real rows into one verified delisting family, in knowledge order", () => {
    const ed = build();
    expect(ed.mainCount).toBe(7);
    expect(ed.correctionCount).toBe(0);
    expect(ed.families.map((f) => [f.label, f.items.length])).toEqual([["Delistings (Form 25)", 7]]);
    const known = ed.families[0].items.map((i) => i.envelope.knowledge_at as string);
    expect([...known].sort()).toEqual(known);
    const visa = ed.families[0].items.find((i) => i.company === "VISA INC.")!;
    expect(visa.event).toBe("Delisting: 1.500% Senior Notes due 2026");
    expect(visa.eventDetail).toContain("Class redeemed or paid at maturity or retirement");
    expect(visa.effectiveBasis).toBe("Form 25 signature date");
    expect(visa.knowledgeBasis).toBe("SEC acceptance time");
    expect(visa.effectiveEstimate).toBe("2026-06-25");
    expect(visa.sourceUrl).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1403161\//);
    expect(visa.sourceLabel).toBe("0000876661-26-000531");
    expect(visa.identifiers).toEqual(["CIK 0001403161"]);
  });

  it("writes each envelope with the bytes of ERM3 contract.to_json plus one license_label key", () => {
    const ed = build();
    expect(ed.attachment.lines).toBe(7);
    expect(ed.attachment.filename).toBe("events_2026-11-10.jsonl");
    expect(ed.attachment.sha256).toBe(createHash("sha256").update(ed.attachment.body).digest("hex"));
    const lines = ed.attachment.body.trim().split("\n");
    const stripped = lines.map((line) => {
      const env = JSON.parse(line);
      expect(env.schema_version).toBe("1.0.0");
      for (const f of ENVELOPE_REQUIRED_FIELDS) expect(env).toHaveProperty(f);
      expect(canonicalJson(env)).toBe(line);
      expect(env.license_label).toBe(
        `Public record (SEC filing). Use and quote under the free edition terms (${FEED_TERMS_URL}).`,
      );
      delete env.license_label;
      return canonicalJson(env) + "\n";
    });
    // Removing license_label gives back the contract bytes exactly.
    expect(stripped.join("")).toBe(PY_JSONL);
  });

  it("uses a stable subject", () => {
    expect(digestSubject(build())).toBe("RiskModels Event Ledger — 2026-11-10 — 7 events");
    expect(digestSubject(build(ROWS.slice(0, 1)))).toBe("RiskModels Event Ledger — 2026-11-10 — 1 event");
    expect(digestSubject(build([], { window: { basis: "ledger_seq", after_seq: 5050, through_seq: 5050 } }))).toBe(
      "RiskModels Event Ledger — 2026-11-10 — 0 events",
    );
    expect(digestSubject(build(ROWS, { sample: true }))).toMatch(/^\[Sample\] RiskModels Event Ledger/);
  });

  it("withholds rows whose license is not redistributable, and says nothing about them", async () => {
    const internal = clone(ROWS[0]);
    internal.envelope.license = { basis: null, classification: "internal_only", redistributable: false };
    const ed = build([internal, ...ROWS.slice(1)]);
    expect(ed.mainCount).toBe(6);
    expect(ed.withheld.internal_only_in_client_edition).toBe(1);
    const html = await render(EventLedgerDigestEmail({ edition: ed }));
    const text = renderDigestText(ed);
    const name = internal.envelope.payload!.issuer_name as string;
    for (const body of [html, text, ed.attachment.body]) expect(body).not.toContain(name);
    expect(text).not.toMatch(/withheld/i);
  });

  it("withholds a row whose payload carries a restricted identifier key", () => {
    const bad = clone(ROWS[0]);
    const key = ["pisuc"][0].split("").reverse().join("");
    bad.envelope.payload = { ...bad.envelope.payload, [key]: "x" };
    const ed = build([bad]);
    expect(ed.mainCount).toBe(0);
    expect(ed.withheld.restricted_identifier_key).toBe(1);
  });

  it("withholds a row whose text quotes a restricted identifier word, instead of refusing the edition", async () => {
    // Four live Form 25 rows quote one in security_description; this is a real row with that shape.
    const bad = clone(ROWS[0]);
    const word = "nisi".split("").reverse().join("").toUpperCase();
    bad.envelope.payload = { ...bad.envelope.payload, security_description: `Common Stock (${word} on file)` };
    const ed = build([bad, ...ROWS.slice(1)]);
    expect(ed.withheld.restricted_identifier_key).toBe(1);
    expect(ed.mainCount).toBe(6);
    const html = await render(EventLedgerDigestEmail({ edition: ed }));
    expect(restrictedWordHits(html, renderDigestText(ed), ed.attachment.body)).toEqual([]);
  });

  it("flags a correction that supersedes an earlier event", () => {
    const corr = clone(ROWS[6]);
    corr.seq = 99999;
    corr.envelope.supersedes_event_id = ROWS[5].envelope.event_id;
    corr.envelope.correction_reason = "accession re-read";
    const ed = build([...ROWS, corr]);
    expect(ed.correctionCount).toBe(1);
    const flagged = ed.families[0].items.find((i) => i.flag)!;
    expect(flagged.flag).toBe(`Correction of event ${ROWS[5].envelope.event_id.slice(0, 8)}: accession re-read`);
    expect(renderDigestText(ed)).toContain("FLAG:");
  });

  it("shows candidates under review by default, behind one setting, and capped", () => {
    expect(INCLUDE_UNDER_REVIEW_DEFAULT).toBe(true);
    const cands = ROWS.map((r) => {
      const c = clone(r);
      c.envelope.lifecycle_status = "candidate";
      return c;
    });
    const ed = build(cands, { reviewCap: 3 });
    expect(ed.mainCount).toBe(0);
    expect(ed.underReview).toMatchObject({ total: 7, notShown: 4 });
    expect(ed.underReview.items).toHaveLength(3);
    expect(ed.attachment.lines).toBe(3);
    const text = renderDigestText(ed);
    expect(text).toContain("Under review, not verified: 7 (showing 3)");
    expect(text).toContain("4 more rows are not shown");
    expect(digestSubject(ed)).toBe("RiskModels Event Ledger — 2026-11-10 — 0 events — 7 under review");
    const off = build(cands, { includeUnderReview: false });
    expect(off.underReview.total).toBe(0);
    expect(off.attachment.lines).toBe(0);
  });

  it("never puts an internal_only row in a client edition, whatever the settings", async () => {
    // A real row relicensed internal_only, as every current identifier_rekey candidate is.
    const internal = clone(ROWS[0]);
    internal.envelope.lifecycle_status = "candidate";
    internal.envelope.source_role = "internal_derived";
    internal.envelope.license = { basis: null, classification: "internal_only", redistributable: false };
    const name = internal.envelope.payload!.issuer_name as string;
    for (const includeUnderReview of [true, false]) {
      const ed = build([internal], { includeUnderReview, audience: "client", reviewCap: 100 });
      expect(ed.internalOnly.total).toBe(0);
      expect(ed.underReview.total).toBe(0);
      expect(ed.attachment.lines).toBe(0);
      const html = await render(EventLedgerDigestEmail({ edition: ed }));
      for (const body of [html, renderDigestText(ed), ed.attachment.body]) {
        expect(body).not.toContain(name);
        expect(body).not.toContain(INTERNAL_ONLY_HEADING);
      }
    }
    // Default audience is client.
    expect(build([internal]).internalOnly.total).toBe(0);
  });

  it("shows internal_only rows only in an internal edition to the internal recipient", async () => {
    const internal = clone(ROWS[0]);
    internal.envelope.lifecycle_status = "candidate";
    internal.envelope.license = { basis: null, classification: "internal_only", redistributable: false };
    expect(() => build([internal], { audience: "internal" })).toThrow(InternalRecipientError);
    expect(() => build([internal], { audience: "internal", recipient: "analyst@example.com" })).toThrow(
      InternalRecipientError,
    );
    const ed = build([internal, ...ROWS.slice(1)], { audience: "internal", recipient: "conrad@bwmacro.com" });
    expect(ed.mainCount).toBe(6);
    expect(ed.internalOnly.total).toBe(1);
    expect(ed.attachment.lines).toBe(7);
    const html = await render(EventLedgerDigestEmail({ edition: ed }));
    expect(html).toContain("Internal only, not for clients. Under review, not verified: 1");
    expect(renderDigestText(ed)).toContain("must not be forwarded or sent to clients");
  });

  it("says an empty day plainly", async () => {
    const ed = build([], { window: { basis: "ledger_seq", after_seq: 5050, through_seq: 5050 } });
    const text = renderDigestText(ed);
    expect(text).toContain("No new events since the last edition.");
    const html = await render(EventLedgerDigestEmail({ edition: ed }));
    expect(html).toContain("Nothing to report in this window.");
    expect(ed.attachment.body).toBe("");
  });

  it("carries the descriptor in both parts, matching the attachment, with no restricted words", async () => {
    const ed = build();
    const html = await render(EventLedgerDigestEmail({ edition: ed }));
    const text = renderDigestText(ed);
    const expected = JSON.parse(JSON.stringify(buildDigestDescriptor(ed)));
    expect(descriptorFrom(html)).toEqual(expected);
    expect(descriptorFrom(text)).toEqual(expected);
    expect(expected.attachment).toMatchObject({ lines: 7, sha256: ed.attachment.sha256, format: "jsonl" });
    expect(expected.counts).toEqual({
      by_lifecycle_status: { verified: 7 },
      by_event_type: { delisting: 7 },
      sections: { main: 7, under_review: { shown: 0, total: 0 } },
    });
    for (const re of FORBIDDEN) {
      expect(html).not.toMatch(re);
      expect(text).not.toMatch(re);
    }
    expect(restrictedWordHits(html, text, ed.attachment.body)).toEqual([]);
    expect(html).toContain("#002a5e");
    expect(html).toContain("#006f8e");
    expect(html).toContain('href="https://www.sec.gov/Archives/edgar/data/1403161/');
  });

  it("builds a message with plain text, HTML and the attachment", () => {
    const ed = build();
    const eml = buildMimeMessage({
      to: "conrad@bwmacro.com",
      subject: digestSubject(ed),
      text: renderDigestText(ed),
      html: "<p>x</p>",
      attachment: { filename: ed.attachment.filename, contentType: "application/x-ndjson", body: ed.attachment.body },
      date: new Date("2026-11-11T14:00:00Z"),
    });
    expect(eml).toMatch(/^To: conrad@bwmacro\.com\r\n/);
    expect(eml).toContain(`Subject: =?UTF-8?B?${Buffer.from(digestSubject(ed)).toString("base64")}?=`);
    expect(eml).toContain("Content-Type: multipart/alternative");
    expect(eml).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(eml).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(eml).toContain('Content-Disposition: attachment; filename="events_2026-11-10.jsonl"');
  });

  it("labels Rule 12d2-2 provisions in the rule's terms", () => {
    expect(provisionLabel("17 CFR 240.12d2-2(a)(3)")).toBe("class replaced by other securities, e.g. in a merger");
    expect(provisionLabel("17 CFR 240.12d2-2(b)")).toBe("removed by the exchange under its rules");
    expect(provisionLabel("17 CFR 240.12d2-2(c)")).toBe("withdrawn by the issuer");
    expect(provisionLabel(null)).toBeNull();
  });

  describe("licensed data: allow-list per event type, then a case-aware market cap and price scan", () => {
    const withPayload = (extra: Record<string, unknown>) => {
      const r = clone(ROWS[0]);
      r.envelope.payload = { ...r.envelope.payload, ...extra };
      return r;
    };

    it("passes every real verified row: all their paths are on the delisting allow-list", () => {
      for (const r of ROWS) expect(allowListViolations(r.envelope)).toEqual([]);
      const ed = build();
      expect(ed.withheld.path_not_on_allow_list).toBe(0);
      expect(ed.withheld.market_cap_or_price).toBe(0);
    });

    it("withholds an event with any key off the list: payload, nested, top-level, source, provenance, risk_layers, affected", async () => {
      const variants: Array<[string, (r: LedgerRow) => void]> = [
        ["payload key", (r) => ((r.envelope.payload as Record<string, unknown>).note = "x")],
        ["nested value", (r) => ((r.envelope.payload as Record<string, unknown>).security_description = { text: "Common Stock", px: 12 })],
        ["top-level key", (r) => ((r.envelope as Record<string, unknown>).extra = "x")],
        ["source key", (r) => ((r.envelope.source as Record<string, unknown>).vendor_id = "x")],
        ["provenance key", (r) => ((r.envelope.provenance as Record<string, unknown>).host = "x")],
        ["risk_layers element", (r) => ((r.envelope as Record<string, unknown>).risk_layers = [{ layer: "l1" }])],
        ["affected child", (r) => ((r.envelope as Record<string, unknown>).affected = { bw_sym_id: "x" })],
        ["entity key", (r) => ((r.envelope.entity as Record<string, unknown>).exchange = "x")],
      ];
      for (const [label, mutate] of variants) {
        const bad = clone(ROWS[0]);
        mutate(bad);
        const ed = build([bad, ...ROWS.slice(1)]);
        expect(ed.withheld.path_not_on_allow_list, label).toBe(1);
        expect(ed.mainCount, label).toBe(6);
        expect(ed.attachment.body, label).not.toContain(bad.envelope.payload!.issuer_name as string);
      }
    });

    it("never lets an event type without a client list reach a client", () => {
      const other = clone(ROWS[0]);
      other.envelope.event_type = "rename";
      expect(allowListViolations(other.envelope)).toEqual(["event_type"]);
      expect(build([other]).withheld.path_not_on_allow_list).toBe(1);
    });

    it("catches exact market cap and price identifiers, case-aware, including log and weighted names", () => {
      for (const id of [
        "marketCapUsd",
        "market_cap",
        "MarketCap",
        "MCAP",
        "mkt_cap",
        "mcap",
        "market_cap_log",
        "weighted_market_cap",
        "market_value",
        "marketValue",
        "float_cap",
        "closePrice",
        "lastPrice",
        "px_last",
        "PX_LAST",
        "adj_close",
        "last_trade_date",
      ]) {
        expect(priceOrCapHits(`{"${id}":1}`), id).not.toEqual([]);
      }
      expect(priceOrCapHits("Market cap: $1.2B")).not.toEqual([]);
    });

    it("does not flag figures computed from market cap, or a warrant's exercise price in filing text", () => {
      for (const id of ["market_cap_weight", "capWeight", "market_cap_rank", "size_bucket", "log_market_cap_z", "mcap_decile"]) {
        expect(priceOrCapHits(`{"${id}":1}`), id).toEqual([]);
      }
      expect(priceOrCapHits("Warrants, each exercisable for one share at an exercise price of $11.50")).toEqual([]);
      expect(priceOrCapHits("market cap weight 1.2%")).toEqual([]);
      // A live Form 25 issuer name.
      expect(priceOrCapHits('{"security_description":"MCAP Acquisition Corporation Unit"}')).toEqual([]);
    });

    it("withholds an event whose string value carries a price or a market cap", () => {
      for (const text of ["Common Stock (closePrice 12.41)", "Common Stock px_last=12.41", "Common Stock, market cap $1.2B"]) {
        const ed = build([withPayload({ security_description: text }), ...ROWS.slice(1)]);
        expect(ed.withheld.market_cap_or_price, text).toBe(1);
        expect(ed.attachment.body).not.toContain(text);
      }
    });

    it("keeps exact market cap out of the client edition and its file, and refuses output that labels one", async () => {
      const bad = withPayload({ marketCapUsd: 1.23e9 });
      const ed = build([bad, ...ROWS.slice(1)]);
      expect(ed.mainCount).toBe(6);
      const html = await render(EventLedgerDigestEmail({ edition: ed }));
      const text = renderDigestText(ed);
      for (const body of [html, text, ed.attachment.body]) expect(body).not.toMatch(/marketCap/i);
      expect(priceOrCapHits(html, text, ed.attachment.body)).toEqual([]);
      expect(marketCapHits('{"marketCapUsd":1}')).not.toEqual([]);
    });

    it("checks values at allowed paths: fixed sets, numbers, a ticker pattern, strings elsewhere", () => {
      for (const r of ROWS) expect(valueViolations(r.envelope)).toEqual([]);
      const variants: Array<[string, (r: LedgerRow) => void]> = [
        ["validation_state", (r) => ((r.envelope as Record<string, unknown>).validation_state = "close 12.41")],
        ["provenance.contributor", (r) => ((r.envelope.provenance as Record<string, unknown>).contributor = "someone")],
        ["confidence", (r) => ((r.envelope as Record<string, unknown>).confidence = "0.95")],
        ["payload.confidence", (r) => ((r.envelope.payload as Record<string, unknown>).confidence = 95)],
        ["entity.ticker", (r) => ((r.envelope.entity as Record<string, unknown>).ticker = "12.41 USD")],
        ["payload.issuer_name", (r) => ((r.envelope.payload as Record<string, unknown>).issuer_name = 12.41)],
        ["programs[]", (r) => ((r.envelope as Record<string, unknown>).programs = ["changefeed", "prices"])],
      ];
      for (const [label, mutate] of variants) {
        const bad = clone(ROWS[0]);
        mutate(bad);
        expect(valueViolations(bad.envelope), label).toContain(label);
        expect(build([bad]).withheld.value_not_allowed, label).toBe(1);
      }
      const ok = clone(ROWS[0]);
      ok.envelope.entity = { ...ok.envelope.entity, ticker: "BRK.B" };
      expect(valueViolations(ok.envelope)).toEqual([]);
    });

    it("scans filing text for price and market value prose, after NFKC and zero-width stripping", () => {
      for (const text of [
        "Common Stock; last price $12.41",
        "Common Stock (last sale 12.41)",
        "aggregate market value of $40 million",
        "Common Stock, mkt cap 1.2B",
        "Common Stock at a share price of $3",
        "Common Stock, market\u200Bcap 1.2B",
        "Common Stock, ｍａｒｋｅｔ ｃａｐ 1.2B",
        "Common Stock, last\u00ADprice 9",
      ]) {
        expect(priceOrCapHits(JSON.stringify({ security_description: text })), text).not.toEqual([]);
        const ed = build([withPayload({ security_description: text })]);
        expect(ed.withheld.market_cap_or_price, text).toBe(1);
      }
      for (const text of [
        "Warrants, each exercisable for one share at an exercise price of $11.50",
        "MCAP Acquisition Corporation Unit",
      ]) {
        expect(priceOrCapHits(JSON.stringify({ security_description: text })), text).toEqual([]);
      }
    });

    it("applies the allow-list and the scan to client editions only (internal goes to INTERNAL_RECIPIENTS)", () => {
      const ed = build([withPayload({ market_cap: 1 })], { audience: "internal", recipient: "conrad@bwmacro.com" });
      expect(ed.mainCount).toBe(1);
    });

    it("allows derived entity fields in a client edition and names them in the license_label", () => {
      const mapped = clone(ROWS[0]);
      mapped.envelope.entity = { ...mapped.envelope.entity, ticker: "V", entity_name: "VISA INC." };
      const ed = build([mapped]);
      expect(ed.mainCount).toBe(1);
      const line = JSON.parse(ed.attachment.body);
      expect(line.license_label).toContain("Fields entity.ticker, entity.entity_name are derived by RiskModels.");
      expect(licenseLabel(ROWS[0].envelope)).not.toContain("derived");
    });
  });

  describe("per-recipient footer", () => {
    const contact = { unsubscribe_token: "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f", purpose: "contact", referral_code: "9018ddd80c6a" };

    it("carries the referral link, the team-inbox link, unsubscribe and terms for a contact", async () => {
      const ed = build();
      const f = editionFooter(contact);
      expect(f.forwardUrl).toBe("https://riskmodels.app/security-master-feed?ref=9018ddd80c6a#join");
      expect(f.teamInboxUrl).toBe(`https://riskmodels.app/security-master-feed/delivery?token=${contact.unsubscribe_token}`);
      expect(f.unsubscribeUrl).toBe(`https://riskmodels.app/security-master-feed/unsubscribe?token=${contact.unsubscribe_token}`);
      const html = unescapeHtml(await render(EventLedgerDigestEmail({ edition: ed, footer: f })));
      const text = renderDigestText(ed, f);
      for (const body of [html, text]) {
        expect(body).toContain(f.forwardUrl);
        expect(body).toContain(f.teamInboxUrl!);
        expect(body).toContain(f.unsubscribeUrl!);
        expect(body).toContain(FEED_TERMS_URL);
        expect(body).toContain("Send this to your team inbox instead");
        expect(body).toContain("Forward to a colleague");
      }
      expect(text).toContain("stop delivery to this address once the team inbox confirms");
      // The footer link is the unsubscribe page (one button); one-click unsubscribe rides in the headers.
      expect(html).not.toContain("/api/feed-waitlist/unsubscribe");
    });

    it("offers no team-inbox link to a delivery inbox, and no personal links to an unlisted reader", async () => {
      const inbox = editionFooter({ ...contact, purpose: "feed" });
      expect(inbox.teamInboxUrl).toBeNull();
      expect(inbox.unsubscribeUrl).not.toBeNull();
      const none = editionFooter(null);
      expect(none).toMatchObject({ teamInboxUrl: null, unsubscribeUrl: null });
      expect(none.forwardUrl).toBe("https://riskmodels.app/security-master-feed#join");
      const text = renderDigestText(build(), none);
      expect(text).not.toContain("Send this to your team inbox instead");
      expect(text).not.toContain("Unsubscribe:");
    });

    it("gives the internal edition no forward link and no personal token", async () => {
      const f = internalFooter();
      expect(f).toMatchObject({ forwardUrl: null, teamInboxUrl: null, unsubscribeUrl: null });
      const ed = build([], { audience: "internal", recipient: "conrad@bwmacro.com" });
      const html = await render(EventLedgerDigestEmail({ edition: ed, footer: f }));
      const text = renderDigestText(ed, f);
      for (const body of [html, text]) {
        expect(body).not.toContain("Forward to a colleague");
        expect(body).not.toContain("token=");
        expect(body).toContain(FEED_TERMS_URL);
      }
    });

    it("drops a malformed referral code instead of putting it in a link", () => {
      expect(editionFooter({ ...contact, referral_code: "<script>" }).forwardUrl).toBe(
        "https://riskmodels.app/security-master-feed#join",
      );
    });
  });

  describe("GDELT credit", () => {
    it("adds the credit when a delivered event is GDELT-derived, and not otherwise", async () => {
      const g = clone(ROWS[0]);
      g.envelope.lifecycle_status = "candidate";
      g.envelope.source = { ...g.envelope.source, source_system: "gdelt_doc_v1" };
      g.envelope.license = { basis: "gdelt_metadata_discovery_only", classification: "internal_only", redistributable: false };
      const internal = build([g], { audience: "internal", recipient: "conrad@bwmacro.com" });
      expect(internal.gdeltCredit).toBe(true);
      expect(renderDigestText(internal)).toContain(GDELT_CREDIT);
      expect(await render(EventLedgerDigestEmail({ edition: internal }))).toContain("gdeltproject.org");
      // The adapter marks them internal_only, so a client edition never carries one or the credit.
      const client = build([g]);
      expect(client.gdeltCredit).toBe(false);
      expect(client.attachment.lines).toBe(0);
      expect(build().gdeltCredit).toBe(false);
    });
  });

  describe("public latest-events file", () => {
    it("lists verified client-deliverable events newest first, with their license labels", () => {
      const file = buildPublicLatest(ROWS, { generatedAt: "2026-11-13T18:00:00Z", count: 5 });
      expect(file.count).toBe(5);
      const known = file.events.map((e) => e.known_date!);
      expect([...known].sort().reverse()).toEqual(known);
      expect(file.latest_known_date).toBe("2026-06-15");
      for (const e of file.events) expect(e.license_label).toContain("Public record (SEC filing).");
      expect(restrictedWordHits(JSON.stringify(file))).toEqual([]);
      expect(priceOrCapHits(JSON.stringify(file))).toEqual([]);
    });

    it("never shows a superseded original unflagged: the correction is shown flagged and the original dropped", () => {
      const corr = clone(ROWS[6]);
      corr.seq = 99999;
      corr.envelope.event_id = "a0c0ffee-0000-5000-8000-000000000001";
      corr.envelope.supersedes_event_id = ROWS[5].envelope.event_id;
      corr.envelope.correction_reason = "accession re-read";
      const file = buildPublicLatest([...ROWS, corr], { generatedAt: "2026-11-13T18:00:00Z" });
      const ids = file.events.map((e) => e.event_id);
      expect(ids).not.toContain(ROWS[5].envelope.event_id);
      const shown = file.events.find((e) => e.event_id === corr.envelope.event_id)!;
      expect(shown.flag).toBe(`Correction of event ${ROWS[5].envelope.event_id.slice(0, 8)}: accession re-read`);
      // A withheld correction still removes the original it replaces.
      const hidden = clone(corr);
      hidden.envelope.license = { basis: null, classification: "internal_only", redistributable: false };
      const file2 = buildPublicLatest([...ROWS, hidden], { generatedAt: "2026-11-13T18:00:00Z" });
      expect(file2.events.map((e) => e.event_id)).not.toContain(ROWS[5].envelope.event_id);
      // A row whose own status is superseded is never shown.
      const sup = clone(ROWS[4]);
      sup.envelope.lifecycle_status = "superseded";
      const file3 = buildPublicLatest([sup], { generatedAt: "2026-11-13T18:00:00Z" });
      expect(file3.events).toHaveLength(0);
      // A withdrawal is shown flagged.
      const wd = clone(ROWS[3]);
      wd.envelope.lifecycle_status = "rejected";
      wd.envelope.correction_reason = "filing withdrawn";
      expect(buildPublicLatest([wd], { generatedAt: "2026-11-13T18:00:00Z" }).events[0].flag).toBe("Withdrawn: filing withdrawn");
    });

    it("fetches withdrawals and corrections as well as verified events, so the original is dropped", async () => {
      // A real row withdrawn by a later rejected event that supersedes it.
      const wd = clone(ROWS[3]);
      wd.seq = 99998;
      wd.envelope.event_id = "a0c0ffee-0000-5000-8000-000000000002";
      wd.envelope.lifecycle_status = "rejected";
      wd.envelope.supersedes_event_id = ROWS[2].envelope.event_id;
      wd.envelope.correction_reason = "filing withdrawn";
      const table = [...ROWS, wd];
      const queries: string[] = [];
      // A stand-in for the PostgREST read that honours the two filters the loader sends.
      const getRows = async (q: string) => {
        queries.push(q);
        if (q === PUBLIC_LATEST_QUERIES[0]) {
          return table.filter((r) => ["verified", "rejected", "superseded"].includes(String(r.envelope.lifecycle_status)));
        }
        if (q === PUBLIC_LATEST_QUERIES[1]) return table.filter((r) => r.envelope.supersedes_event_id);
        throw new Error(`unexpected query ${q}`);
      };
      const file = await loadPublicLatest(getRows, { generatedAt: "2026-11-13T18:00:00Z" });
      expect(queries).toEqual([...PUBLIC_LATEST_QUERIES]);
      const ids = file.events.map((e) => e.event_id);
      expect(ids).not.toContain(ROWS[2].envelope.event_id);
      expect(file.events.find((e) => e.event_id === wd.envelope.event_id)?.flag).toContain("Correction of event");
      // The old verified-only read would have shown the original unflagged.
      const verifiedOnly = buildPublicLatest(table.filter((r) => r.envelope.lifecycle_status === "verified"), {
        generatedAt: "2026-11-13T18:00:00Z",
      });
      expect(verifiedOnly.events.map((e) => e.event_id)).toContain(ROWS[2].envelope.event_id);
    });

    it("states in its selection text that ticker and company name are derived", () => {
      const file = buildPublicLatest(ROWS, { generatedAt: "2026-11-13T18:00:00Z" });
      expect(file.selection).toContain("Ticker and company name, when present, are derived by RiskModels");
    });

    it("leaves out candidates, internal rows and market cap rows", () => {
      const cand = clone(ROWS[0]);
      cand.envelope.lifecycle_status = "candidate";
      const internal = clone(ROWS[1]);
      internal.envelope.license = { basis: null, classification: "internal_only", redistributable: false };
      const cap = clone(ROWS[2]);
      cap.envelope.payload = { ...cap.envelope.payload, market_cap: 1 };
      const file = buildPublicLatest([cand, internal, cap, ...ROWS.slice(3)], { generatedAt: "2026-11-13T18:00:00Z" });
      expect(file.count).toBe(4);
      const ids = file.events.map((e) => e.event_id);
      for (const r of [cand, internal, cap]) expect(ids).not.toContain(r.envelope.event_id);
    });
  });
});
