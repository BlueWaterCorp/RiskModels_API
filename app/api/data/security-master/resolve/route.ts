import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

interface ResolveIdentifier {
  type: "cusip" | "isin";
  value: string;
}

/**
 * POST /api/data/security-master/resolve
 *
 * Resolve CUSIP/ISIN identifiers to tickers via security_master.
 * Body: { identifiers: [{ type: "cusip", value: "037833100" }, ...] }
 *
 * Returns: { resolved: [{ type, value, ticker, symbol }] }
 */
export async function POST(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  let body: { identifiers?: ResolveIdentifier[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const identifiers = body.identifiers;
  if (!Array.isArray(identifiers) || identifiers.length === 0) {
    return NextResponse.json(
      { error: "identifiers array is required" },
      { status: 400 },
    );
  }

  if (identifiers.length > 500) {
    return NextResponse.json(
      { error: "Max 500 identifiers per request" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const resolved: Array<{
    type: string;
    value: string;
    ticker: string | null;
    symbol: string | null;
  }> = [];

  // Group by type for batching
  const cusips = identifiers
    .filter((id) => id.type === "cusip")
    .map((id) => id.value.trim().toUpperCase());
  const isins = identifiers
    .filter((id) => id.type === "isin")
    .map((id) => id.value.trim().toUpperCase());

  const cusipMap = new Map<string, { ticker: string; symbol: string }>();
  const isinMap = new Map<string, { ticker: string; symbol: string }>();

  // Batch CUSIP lookup
  if (cusips.length > 0) {
    const { data, error } = await supabase
      .from("security_master")
      .select("ticker, bw_sym_id, cusip")
      .in("cusip", cusips)
      .is("valid_to", null);

    if (!error && data) {
      for (const row of data) {
        cusipMap.set(row.cusip.toUpperCase(), {
          ticker: row.ticker,
          symbol: row.bw_sym_id,
        });
      }
    }
  }

  // Batch ISIN lookup
  if (isins.length > 0) {
    const { data, error } = await supabase
      .from("security_master")
      .select("ticker, bw_sym_id, isin")
      .in("isin", isins)
      .is("valid_to", null);

    if (!error && data) {
      for (const row of data) {
        isinMap.set(row.isin.toUpperCase(), {
          ticker: row.ticker,
          symbol: row.bw_sym_id,
        });
      }
    }
  }

  // Build response
  for (const id of identifiers) {
    const normalized = id.value.trim().toUpperCase();
    const lookup =
      id.type === "cusip"
        ? cusipMap.get(normalized)
        : isinMap.get(normalized);
    resolved.push({
      type: id.type,
      value: id.value,
      ticker: lookup?.ticker ?? null,
      symbol: lookup?.symbol ?? null,
    });
  }

  return NextResponse.json({ resolved });
}
