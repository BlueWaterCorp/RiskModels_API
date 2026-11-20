/**
 * Form 25 delisting events from edgar_delisting 1.2.0: the removal date stated with the Form 25,
 * the trading stop read from the issuer's 8-K item 2.01, and corrections that supersede an earlier
 * event. Base row: the real Beazer Homes envelope (tests/fixtures/event-ledger/delisting-bzh-20261020.json).
 * The earlier event it corrects, and the fallbacks, are planted on that row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { EventLedgerDigestEmail } from "@/emails/event-ledger-digest";
import {
  DATES_NOTE,
  allowListViolations,
  basisLabel,
  buildDigest,
  headline,
  renderDigestText,
  restrictedWordHits,
  priceOrCapHits,
  toItem,
  valueViolations,
  withheldReason,
  type LedgerRow,
} from "@/lib/event-ledger-digest";
import { buildPublicLatest } from "@/lib/event-ledger-public";

const BZH: LedgerRow = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "event-ledger", "delisting-bzh-20261020.json"), "utf8"),
).rows[0];
const clone = (r: LedgerRow): LedgerRow => JSON.parse(JSON.stringify(r));

const SEQ = { basis: "ledger_seq", after_seq: 5199, through_seq: 5201 } as const;
const build = (rows: LedgerRow[], editionDate = "2026-11-19") => buildDigest(rows, { editionDate, window: SEQ });

function unescapeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const FORM25_FOLDER = "https://www.sec.gov/Archives/edgar/data/915840/000087666126000851/";
const EIGHT_K_FOLDER = "https://www.sec.gov/Archives/edgar/data/915840/000110465926117198/";

/** Signature-date version of BZH, as an earlier adapter run would have minted it (planted). */
function signatureVersion(): LedgerRow {
  const o = clone(BZH);
  o.seq = 5200;
  o.envelope.effective_at = "2026-10-20T00:00:00+00:00";
  o.envelope.effective_basis = "form25_signature_date";
  Object.assign(o.envelope.payload!, {
    stated_effective_date: null,
    trading_stopped_basis: "no_8k_2_01_or_3_01_accepted_by_form25",
    trading_stopped_date: null,
    trading_stopped_knowledge_at: null,
    trading_stopped_source_accession: null,
    trading_stopped_source_event_date: null,
    trading_stopped_source_event_date_source: null,
    trading_stopped_source_form: null,
    trading_stopped_source_items: null,
  });
  return o;
}
const ORIG = signatureVersion();

/** The real BZH envelope as edgar_delisting's supersede() would append it over ORIG: same dedupe_key, new id. */
const REASON =
  "Listing removal date updated from the Form 25 signature date (2026-10-20) to the exchange's stated removal date (2026-11-02); trading stop added: 2026-10-20 from the 8-K completion date.";
function correction(seq: number, id: string, of: LedgerRow): LedgerRow {
  const c = clone(BZH);
  c.seq = seq;
  c.envelope.event_id = id;
  c.envelope.supersedes_event_id = of.envelope.event_id;
  c.envelope.correction_reason = REASON;
  return c;
}
const CORR = correction(5201, "0b1e5c55-2c43-5c6e-9d0a-5d2c1a9e7f01", ORIG);

describe("Form 25 delisting, adapter 1.2.0 (BZH)", () => {
  it("passes the client gate: every new payload path is on the allow-list, every value allowed", () => {
    expect(allowListViolations(BZH.envelope)).toEqual([]);
    expect(valueViolations(BZH.envelope)).toEqual([]);
    for (const r of [BZH, ORIG, CORR]) expect(withheldReason(r.envelope, "client")).toBeNull();
    const ed = build([BZH]);
    expect(ed.mainCount).toBe(1);
    expect(Object.values(ed.withheld).every((n) => n === 0)).toBe(true);
  });

  it("holds every new payload value to its rule", () => {
    const bad: [string, unknown][] = [
      ["stated_effective_date_rejected", "after_signature"],
      ["signature_date", "10/20/2026"],
      ["stated_effective_date", "2026-11-02T00:00:00Z"],
      ["trading_stopped_date", "2026-10"],
      ["trading_stopped_source_event_date", 20261020],
      ["trading_stopped_knowledge_at", "2026-10-20 16:54"],
      ["trading_stopped_basis", "8k_item_3_01_event_date"],
      ["trading_stopped_source_event_date_source", "guessed"],
      ["trading_stopped_source_accession", "0001104659-26-11719"],
      ["trading_stopped_source_form", "10-K"],
      ["trading_stopped_source_items", ["3.01", "x"]],
    ];
    for (const [k, v] of bad) {
      const r = clone(BZH);
      r.envelope.payload![k] = v;
      expect([k, withheldReason(r.envelope, "client")]).toEqual([k, "value_not_allowed"]);
    }
    const good: [string, unknown][] = [
      ["stated_effective_date_rejected", "before_filing"],
      ["trading_stopped_basis", "8k_item_2_01_date_not_parsed"],
      ["trading_stopped_basis", "8k_item_3_01_notice_date_not_a_trading_stop"],
      ["trading_stopped_source_event_date_source", "filed_date_fallback"],
      ["trading_stopped_source_event_date_source", "effective_as_of_regex"],
      ["trading_stopped_source_form", "8-K/A"],
      ["trading_stopped_knowledge_at", "2026-10-20T16:54:22Z"],
    ];
    for (const [k, v] of good) {
      const r = clone(BZH);
      r.envelope.payload![k] = v;
      expect([k, withheldReason(r.envelope, "client")]).toEqual([k, null]);
    }
    const extra = clone(BZH);
    extra.envelope.payload!.trading_stopped_note = "x";
    expect(withheldReason(extra.envelope, "client")).toBe("path_not_on_allow_list");
    const nested = clone(BZH);
    nested.envelope.payload!.trading_stopped_source_items = [{ item: "3.01" }];
    expect(withheldReason(nested.envelope, "client")).toBe("path_not_on_allow_list");
  });

  it("names the stated removal date neutrally and cites the Form 25 and 8-K filing folders", () => {
    expect(basisLabel("form25_stated_effective_date")).toBe("removal date stated with the Form 25");
    const i = toItem(BZH);
    expect(i.effectiveLabel).toBe("Listing removed");
    expect(i.effectiveBasis).toBe("removal date stated with the Form 25");
    expect(i.effectiveSource).toEqual({
      text: "stated in the exchange's notice filed with the Form 25",
      label: "Form 25-NSE 0000876661-26-000851",
      url: FORM25_FOLDER,
    });
    expect(i.effectiveEstimate).toBeNull();
    expect(i.tradingStopped).toEqual({
      date: "2026-10-20",
      basis: "completion date in the issuer's 8-K (item 2.01)",
      source: "8-K 0001104659-26-117198",
      url: EIGHT_K_FOLDER,
    });
    // An issuer-filed Form 25 is not called the exchange's notice.
    const issuer = clone(BZH);
    issuer.envelope.payload!.source_form = "25";
    expect(toItem(issuer).effectiveSource?.text).toBe("stated with the Form 25");
  });

  it("renders Known, Trading stopped and Listing removed with their filings, in the text and HTML parts", async () => {
    const ed = build([BZH]);
    const text = renderDigestText(ed);
    const lines = [
      "  Known:           2026-10-20 (SEC acceptance time)",
      "  Trading stopped: 2026-10-20 (completion date in the issuer's 8-K (item 2.01))",
      `                   8-K 0001104659-26-117198 ${EIGHT_K_FOLDER}`,
      "  Listing removed: 2026-11-02 (stated in the exchange's notice filed with the Form 25)",
      `                   Form 25-NSE 0000876661-26-000851 ${FORM25_FOLDER}`,
    ];
    expect(text).toContain(lines.join("\n"));
    expect(text).not.toContain("; Rule 12d2-2 default");
    expect(text).toContain(DATES_NOTE);
    expect(DATES_NOTE).toContain("the last trade is normally the session before");
    expect(headline(ed)).toBe("1 verified event: 1 delisting. No corrections to earlier events.");
    const html = unescapeHtml(await render(EventLedgerDigestEmail({ edition: ed })));
    for (const s of [
      "<strong>Known</strong>",
      "<strong>Trading stopped</strong>",
      "<strong>Listing removed</strong>",
      "stated in the exchange's notice filed with the Form 25",
      `href="${FORM25_FOLDER}"`,
      `href="${EIGHT_K_FOLDER}"`,
      DATES_NOTE,
    ]) {
      expect(html).toContain(s);
    }
    expect(restrictedWordHits(html, text, ed.attachment.body)).toEqual([]);
    expect(priceOrCapHits(html, text, ed.attachment.body)).toEqual([]);
  });

  it("shows a trading stop only on the item 2.01 completion basis", async () => {
    for (const basis of [
      "8k_item_2_01_date_not_parsed",
      "8k_item_3_01_notice_date_not_a_trading_stop",
      "no_8k_2_01_or_3_01_accepted_by_form25",
    ]) {
      const row = clone(BZH);
      Object.assign(row.envelope.payload!, { trading_stopped_basis: basis, trading_stopped_date: null });
      // Even a date set against the adapter's rule is not shown.
      const dated = clone(row);
      dated.envelope.payload!.trading_stopped_date = "2026-10-20";
      for (const r of [row, dated]) {
        expect(withheldReason(r.envelope, "client")).toBeNull();
        expect(toItem(r).tradingStopped).toBeNull();
        const ed = build([r]);
        expect(renderDigestText(ed)).not.toContain("  Trading stopped:");
        expect(unescapeHtml(await render(EventLedgerDigestEmail({ edition: ed })))).not.toContain("<strong>Trading stopped</strong>");
      }
    }
  });

  it("never calls a signature or filing date a removal date, and gives the Rule 12d2-2 default", async () => {
    const filed = clone(ORIG);
    filed.envelope.effective_basis = "filed_date_fallback";
    filed.envelope.payload!.signature_date = null;
    for (const [row, label] of [
      [ORIG, "Form 25 signed"],
      [filed, "Form 25 filed"],
    ] as const) {
      const ed = build([row]);
      const text = renderDigestText(ed);
      expect(toItem(row).effectiveLabel).toBe(label);
      expect(text).toContain(
        `${`  ${label}:`.padEnd(19)}2026-10-20 (${basisLabel(row.envelope.effective_basis)}; the form states no removal date); Rule 12d2-2 default (filing + 10 days) 2026-10-30`,
      );
      expect(text).not.toContain("  Listing removed:");
      const html = unescapeHtml(await render(EventLedgerDigestEmail({ edition: ed })));
      expect(html).toContain(`<strong>${label}</strong>`);
      expect(html).not.toContain("<strong>Listing removed</strong>");
    }
  });

  it("says a stated date that precedes the filing was not used", () => {
    const early = clone(ORIG);
    Object.assign(early.envelope.payload!, { stated_effective_date: "2026-10-01", stated_effective_date_rejected: "before_filing" });
    const text = renderDigestText(build([early]));
    expect(text).toContain("(Form 25 signature date; stated removal date precedes the filing; not used)");
    expect(text).not.toContain("the form states no removal date");
  });
});

describe("corrections (BZH superseding its signature-date version)", () => {
  it("lists only the latest event of a dedupe_key, flagged in plain words, and says the original was never listed", () => {
    const ed = build([ORIG, CORR]);
    expect(ed.mainCount).toBe(1);
    expect(ed.correctionCount).toBe(1);
    expect(ed.replaced).toBe(1);
    expect(ed.windowCount).toBe(1);
    const items = ed.families.flatMap((f) => f.items);
    expect(items.map((i) => i.eventId)).toEqual([CORR.envelope.event_id]);
    expect(items[0].flag).toBe(
      `Correction of an earlier event (7d77612c): ${REASON} The event it corrects entered the ledger in this same window and was not listed.`,
    );
    expect(ed.attachment.lines).toBe(1);
    expect(JSON.parse(ed.attachment.body).event_id).toBe(CORR.envelope.event_id);
    const text = renderDigestText(ed);
    expect(text).toContain("  FLAG:            Correction of an earlier event (7d77612c): Listing removal date updated");
    expect(headline(ed)).toBe("1 verified event: 1 delisting. 1 is a correction to earlier events.");
  });

  it("does not claim the original was unsent when it came in an earlier window", () => {
    const ed = build([CORR]);
    expect(ed.families[0].items[0].flag).toBe(`Correction of an earlier event (7d77612c): ${REASON}`);
  });

  it("keeps the latest of a chain of corrections, in any input order", () => {
    const second = correction(5202, "6f3a8e2d-41b7-5a09-8c6e-0e9b7d3f2a11", CORR);
    const ed = buildDigest([second, ORIG, CORR], {
      editionDate: "2026-11-19",
      window: { basis: "ledger_seq", after_seq: 5199, through_seq: 5202 },
    });
    expect(ed.families.flatMap((f) => f.items).map((i) => i.eventId)).toEqual([second.envelope.event_id]);
    expect(ed.replaced).toBe(2);
  });

  it("counts a correction of an event first knowable before the age cutoff", () => {
    expect(build([CORR], "2026-11-19").oldCorrectionCount).toBe(0);
    const late = build([CORR], "2026-12-30");
    expect(late.mainCount).toBe(1);
    expect(late.oldCorrectionCount).toBe(1);
    // A knowledge-date sample has no age cutoff.
    expect(buildDigest([CORR], { editionDate: "2026-12-30", window: { basis: "knowledge_date", from: "2026-10-20", to: "2026-10-20" } }).oldCorrectionCount).toBe(0);
  });

  it("counts a correction the gate withholds; its original stays out", () => {
    const blocked = clone(CORR);
    blocked.envelope.payload!.trading_stopped_note = "not reviewed";
    const ed = build([ORIG, blocked]);
    expect(ed.mainCount).toBe(0);
    expect(ed.withheld.path_not_on_allow_list).toBe(1);
    expect(ed.withheldCorrections).toBe(1);
    expect(build([ORIG, CORR]).withheldCorrections).toBe(0);
  });

  it("the public file shows the correction alone, labelled, in the unchanged shape", () => {
    const file = buildPublicLatest([ORIG, CORR], { generatedAt: "2026-11-21T15:00:00Z" });
    expect(file.count).toBe(1);
    const e = file.events[0];
    expect(e.event_id).toBe(CORR.envelope.event_id);
    expect(e.flag).toBe(`Correction of an earlier event (7d77612c): ${REASON}`);
    expect(e.effective_basis).toBe("removal date stated with the Form 25");
    expect(Object.keys(e).sort()).toEqual(
      [
        "company", "detail", "effective_basis", "effective_date", "event", "event_id", "event_type", "family", "flag",
        "identifiers", "known_basis", "known_date", "license_label", "source_label", "source_url", "status", "ticker",
      ].sort(),
    );
    const only = buildPublicLatest([BZH], { generatedAt: "2026-11-21T15:00:00Z" });
    expect(only.count).toBe(1);
    expect(only.events[0].flag).toBeNull();
  });
});
