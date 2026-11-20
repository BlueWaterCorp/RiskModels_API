/**
 * Form 25 delisting events from edgar_delisting 1.2.0: the exchange's stated removal date, the
 * trading stop read from the issuer's 8-K, and corrections that supersede an earlier event. Base
 * row: the real Beazer Homes envelope (tests/fixtures/event-ledger/delisting-bzh-20261020.json).
 * Corrections and fallbacks are planted on that row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { EventLedgerDigestEmail } from "@/emails/event-ledger-digest";
import {
  allowListViolations,
  basisLabel,
  buildDigest,
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
const build = (rows: LedgerRow[]) => buildDigest(rows, { editionDate: "2026-11-19", window: SEQ });

function unescapeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** A correction of BZH, as edgar_delisting's supersede() mints one: same dedupe_key, new event_id. */
function correctionOf(orig: LedgerRow, seq: number, id: string): LedgerRow {
  const c = clone(orig);
  c.seq = seq;
  c.envelope.event_id = id;
  c.envelope.supersedes_event_id = orig.envelope.event_id;
  c.envelope.correction_reason =
    "remapped by edgar_delisting 1.2.0: effective_at form25_stated_effective_date 2026-11-02, trading_stopped 2026-10-20 (0001104659-26-117198) -> effective_at form25_stated_effective_date 2026-11-02, trading_stopped none";
  c.envelope.ingested_at = "2026-11-21T14:00:00+00:00";
  Object.assign(c.envelope.payload!, {
    trading_stopped_basis: "no_8k_2_01_or_3_01_accepted_by_form25",
    trading_stopped_date: null,
    trading_stopped_knowledge_at: null,
    trading_stopped_source_accession: null,
    trading_stopped_source_event_date: null,
    trading_stopped_source_form: null,
    trading_stopped_source_items: null,
  });
  return c;
}
const CORR = correctionOf(BZH, 5201, "0b1e5c55-2c43-5c6e-9d0a-5d2c1a9e7f01");

describe("Form 25 delisting, adapter 1.2.0 (BZH)", () => {
  it("passes the client gate: every new payload path is on the allow-list, every value allowed", () => {
    expect(allowListViolations(BZH.envelope)).toEqual([]);
    expect(valueViolations(BZH.envelope)).toEqual([]);
    expect(withheldReason(BZH.envelope, "client")).toBeNull();
    expect(withheldReason(CORR.envelope, "client")).toBeNull();
    const ed = build([BZH]);
    expect(ed.mainCount).toBe(1);
    expect(Object.values(ed.withheld).every((n) => n === 0)).toBe(true);
  });

  it("allows the stated-date rejection reason and the no-match nulls, and still withholds an unknown key or value", () => {
    const rejected = clone(BZH);
    Object.assign(rejected.envelope.payload!, { stated_effective_date: null, stated_effective_date_rejected: "before_filing" });
    expect(withheldReason(rejected.envelope, "client")).toBeNull();
    const other = clone(BZH);
    other.envelope.payload!.stated_effective_date_rejected = "after_signature";
    expect(withheldReason(other.envelope, "client")).toBe("value_not_allowed");
    expect(withheldReason(CORR.envelope, "client")).toBeNull();
    const extra = clone(BZH);
    extra.envelope.payload!.trading_stopped_note = "x";
    expect(withheldReason(extra.envelope, "client")).toBe("path_not_on_allow_list");
    const nested = clone(BZH);
    nested.envelope.payload!.trading_stopped_source_items = [{ item: "3.01" }];
    expect(withheldReason(nested.envelope, "client")).toBe("path_not_on_allow_list");
  });

  it("labels the stated removal date in plain words", () => {
    expect(basisLabel("form25_stated_effective_date")).toBe("exchange's stated removal date");
    const i = toItem(BZH);
    expect(i.effectiveLabel).toBe("Listing removed");
    expect(i.effectiveBasis).toBe("exchange's stated removal date");
    expect(i.tradingStopped).toEqual({
      date: "2026-10-20",
      basis: "completion date in the issuer's 8-K (item 2.01)",
      source: "8-K 0001104659-26-117198",
    });
  });

  it("shows Known, Trading stopped and Listing removed in the text and HTML parts", async () => {
    const ed = build([BZH]);
    const text = renderDigestText(ed);
    expect(text).toContain("  Known:           2026-10-20 (SEC acceptance time)");
    expect(text).toContain(
      "  Trading stopped: 2026-10-20 (completion date in the issuer's 8-K (item 2.01); 8-K 0001104659-26-117198)",
    );
    expect(text).toContain(
      "  Listing removed: 2026-11-02 (exchange's stated removal date); Rule 12d2-2 estimate 2026-10-30",
    );
    const known = text.indexOf("  Known:");
    expect(known).toBeLessThan(text.indexOf("  Trading stopped:"));
    expect(text.indexOf("  Trading stopped:")).toBeLessThan(text.indexOf("  Listing removed:"));
    const html = unescapeHtml(await render(EventLedgerDigestEmail({ edition: ed })));
    for (const s of ["Known", "Trading stopped", "Listing removed", "exchange's stated removal date", "2026-11-02"]) {
      expect(html).toContain(s);
    }
    expect(restrictedWordHits(html, text, ed.attachment.body)).toEqual([]);
    expect(priceOrCapHits(html, text, ed.attachment.body)).toEqual([]);
  });

  it("omits the trading-stop line when no 8-K matched", () => {
    const text = renderDigestText(build([CORR]));
    expect(text).not.toContain("Trading stopped:");
    expect(text).toContain("  Listing removed: 2026-11-02");
  });

  it("never calls an item 3.01 notice date a trading stop, even if a date were set", async () => {
    const notice = clone(BZH);
    Object.assign(notice.envelope.payload!, {
      trading_stopped_basis: "8k_item_3_01_notice_date_not_a_trading_stop",
      trading_stopped_date: null,
    });
    const dated = clone(notice);
    dated.envelope.payload!.trading_stopped_date = "2026-10-20";
    for (const row of [notice, dated]) {
      expect(withheldReason(row.envelope, "client")).toBeNull();
      expect(toItem(row).tradingStopped).toBeNull();
      const ed = build([row]);
      expect(renderDigestText(ed)).not.toContain("Trading stopped");
      expect(unescapeHtml(await render(EventLedgerDigestEmail({ edition: ed })))).not.toContain("Trading stopped");
    }
  });

  it("never calls a signature or filing date a removal date", async () => {
    const signed = clone(BZH);
    signed.envelope.effective_at = "2026-10-20T00:00:00+00:00";
    signed.envelope.effective_basis = "form25_signature_date";
    signed.envelope.payload!.stated_effective_date = null;
    const filed = clone(signed);
    filed.envelope.effective_basis = "filed_date_fallback";
    filed.envelope.payload!.signature_date = null;
    for (const [row, label] of [
      [signed, "Form 25 signed"],
      [filed, "Form 25 filed"],
    ] as const) {
      const ed = build([row]);
      const text = renderDigestText(ed);
      expect(toItem(row).effectiveLabel).toBe(label);
      expect(text).toContain(`  ${label}:`.padEnd(19) + "2026-10-20");
      expect(text).toContain("the form states no removal date");
      expect(text).not.toContain("Listing removed");
      const html = unescapeHtml(await render(EventLedgerDigestEmail({ edition: ed })));
      // The footnote explains the term; no date in the table carries it.
      expect(html).toContain(`<strong>${label}</strong>`);
      expect(html).not.toContain("<strong>Listing removed</strong>");
    }
  });
});

describe("corrections (BZH plus a superseding copy)", () => {
  it("lists only the latest event of a dedupe_key in an edition, flagged as a correction", () => {
    const ed = build([BZH, CORR]);
    expect(ed.mainCount).toBe(1);
    expect(ed.correctionCount).toBe(1);
    expect(ed.replaced).toBe(1);
    const items = ed.families.flatMap((f) => f.items);
    expect(items.map((i) => i.eventId)).toEqual([CORR.envelope.event_id]);
    expect(items[0].flag).toMatch(/^Correction of event 7d77612c: remapped by edgar_delisting 1\.2\.0/);
    expect(ed.attachment.lines).toBe(1);
    expect(JSON.parse(ed.attachment.body).event_id).toBe(CORR.envelope.event_id);
    const text = renderDigestText(ed);
    expect(text).toContain("  FLAG:            Correction of event 7d77612c");
    expect(text).toContain("1 is a correction to earlier events.");
  });

  it("keeps the latest of a chain of corrections, in any input order", () => {
    const second = correctionOf(CORR, 5202, "6f3a8e2d-41b7-5a09-8c6e-0e9b7d3f2a11");
    const ed = buildDigest([second, BZH, CORR], {
      editionDate: "2026-11-19",
      window: { basis: "ledger_seq", after_seq: 5199, through_seq: 5202 },
    });
    expect(ed.families.flatMap((f) => f.items).map((i) => i.eventId)).toEqual([second.envelope.event_id]);
    expect(ed.replaced).toBe(2);
  });

  it("drops an original whose correction the gate withholds, and lists nothing for it", () => {
    const blocked = clone(CORR);
    blocked.envelope.payload!.trading_stopped_note = "not reviewed";
    const ed = build([BZH, blocked]);
    expect(ed.mainCount).toBe(0);
    expect(ed.withheld.path_not_on_allow_list).toBe(1);
  });

  it("the public file shows the correction alone, labelled, and drops the original", () => {
    const file = buildPublicLatest([BZH, CORR], { generatedAt: "2026-11-21T15:00:00Z" });
    expect(file.count).toBe(1);
    expect(file.events[0].event_id).toBe(CORR.envelope.event_id);
    expect(file.events[0].flag).toMatch(/^Correction of event 7d77612c/);
    expect(file.events[0].effective_basis).toBe("exchange's stated removal date");
    const only = buildPublicLatest([BZH], { generatedAt: "2026-11-21T15:00:00Z" });
    expect(only.count).toBe(1);
    expect(only.events[0].flag).toBeNull();
  });
});
