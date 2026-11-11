import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { EventLedgerDigestEmail } from "@/emails/event-ledger-digest";
import {
  ENVELOPE_REQUIRED_FIELDS,
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

  it("writes each envelope with the same bytes as ERM3 contract.to_json", () => {
    const ed = build();
    expect(ed.attachment.body).toBe(PY_JSONL);
    expect(ed.attachment.lines).toBe(7);
    expect(ed.attachment.filename).toBe("events_2026-11-10.jsonl");
    expect(ed.attachment.sha256).toBe(createHash("sha256").update(PY_JSONL).digest("hex"));
    for (const line of ed.attachment.body.trim().split("\n")) {
      const env = JSON.parse(line);
      expect(env.schema_version).toBe("1.0.0");
      for (const f of ENVELOPE_REQUIRED_FIELDS) expect(env).toHaveProperty(f);
      expect(canonicalJson(env)).toBe(line);
    }
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
    expect(ed.withheld.not_redistributable).toBe(1);
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

  it("leaves candidates out by default and labels them under review when asked", () => {
    const cand = clone(ROWS[0]);
    cand.envelope.lifecycle_status = "candidate";
    expect(build([cand]).mainCount).toBe(0);
    expect(build([cand]).attachment.lines).toBe(0);
    const ed = build([cand], { includeUnderReview: true });
    expect(ed.mainCount).toBe(0);
    expect(ed.underReview).toHaveLength(1);
    expect(ed.attachment.lines).toBe(1);
    expect(renderDigestText(ed)).toContain("Under review, not verified: 1");
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
    expect(expected.counts).toEqual({ by_lifecycle_status: { verified: 7 }, by_event_type: { delisting: 7 } });
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
});
