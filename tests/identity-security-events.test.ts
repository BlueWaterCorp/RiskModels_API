/**
 * Parity with ERM3 `erm3/shared/security_events.py`: replay the fixture the Python implementation wrote
 * (ERM3 `scripts/symbology/export_identity_parity_fixture.py`) through the TypeScript port.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  applyEvents,
  buildEvents,
  div,
  floor,
  fracToString,
  historicalTickerOwner,
  parseDecimal,
  type EventRow,
  type LegRow,
} from "@/lib/identity/security-events";

const fx = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/identity/security-events-parity.json"), "utf-8"),
) as {
  events: EventRow[];
  legs: LegRow[];
  carry: Array<{ query: Record<string, string>; expected: Record<string, unknown> }>;
  ownership: Array<{ query: { ticker: string; held_on: string }; expected: Record<string, unknown> }>;
};
const events = buildEvents(fx.events, fx.legs);
const num = (s: string | null) => (s == null ? null : fracToString(parseDecimal(s)));

describe("identity events: parity with the Python resolver", () => {
  for (const c of fx.carry) {
    const q = c.query;
    it(`carry ${q.bw_sym_id} x${q.quantity} ${q.acquired_on}→${q.as_of} ${q.fractions ?? ""}${q.known_as_of ?? ""}`, () => {
      const r = applyEvents(events, {
        bw_sym_id: q.bw_sym_id,
        quantity: parseDecimal(q.quantity),
        acquired_on: q.acquired_on,
        as_of: q.as_of,
        known_as_of: q.known_as_of ?? null,
        fractions: (q.fractions as "apply" | "exact") ?? "apply",
      });
      const e = c.expected as {
        status: string;
        holdings: Array<{ bw_sym_id: string; ticker: string; quantity: string }>;
        cash: Array<{ event_id: string; currency: string; amount: string | null; in_lieu_of_units: string | null; in_lieu_of: string | null }>;
        cancelled_by: string[];
        applied_event_ids: string[];
        unresolved_count: number;
      };
      expect(r.status).toBe(e.status);
      expect(r.applied_event_ids).toEqual(e.applied_event_ids);
      expect(r.cancelled_by).toEqual(e.cancelled_by);
      expect(r.unresolved.length).toBe(e.unresolved_count);
      expect(r.holdings.map((h) => [h.bw_sym_id, h.ticker])).toEqual(e.holdings.map((h) => [h.bw_sym_id, h.ticker]));
      // Python Decimal keeps 28 significant digits; compare at the precision Python printed.
      r.holdings.forEach((h, i) => {
        const want = e.holdings[i].quantity;
        const places = (want.split(".")[1] ?? "").length;
        const scale = parseDecimal("1" + "0".repeat(places));
        const got = div(floor({ n: h.quantity.n * scale.n, d: h.quantity.d }), scale);
        expect(fracToString(got)).toBe(num(want));
      });
      expect(
        r.cash.map((x) => [x.event_id, x.currency, x.amount && fracToString(x.amount), x.in_lieu_of_units && fracToString(x.in_lieu_of_units), x.in_lieu_of]),
      ).toEqual(e.cash.map((x) => [x.event_id, x.currency, num(x.amount), num(x.in_lieu_of_units), x.in_lieu_of]));
    });
  }

  for (const c of fx.ownership) {
    it(`owner ${c.query.ticker} on ${c.query.held_on}`, () => {
      expect(historicalTickerOwner(events, c.query.ticker, c.query.held_on)).toEqual(c.expected);
    });
  }
});

describe("exact fractions", () => {
  it("parses and prints exact decimals", () => {
    expect(fracToString(parseDecimal("54.20"))).toBe("54.2");
    expect(fracToString(div(parseDecimal("241917"), parseDecimal("1000000")))).toBe("0.241917");
    expect(fracToString(div(parseDecimal("100"), parseDecimal("3")))).toBe("33.333333333333");
  });
});
