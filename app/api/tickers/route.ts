import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { searchTickers } from "@/lib/dal/ticker-search";
import { fetchTradingCalendar } from "@/lib/dal/risk-engine-v3";
import { createAdminClient } from "@/lib/supabase/admin";

// Enrich metadata with company_name from security_master when symbols lacks it
async function enrichMetadataFromSecurityMaster(
  metadataMap: Record<string, { name: string; sector?: string; sector_etf?: string; subsector_etf?: string }>,
  tickers: string[],
): Promise<Record<string, { name: string; sector?: string; sector_etf?: string; subsector_etf?: string }>> {
  const needEnrich = tickers.filter(
    (t) => metadataMap[t] && metadataMap[t].name === t,
  );
  if (needEnrich.length === 0) return metadataMap;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("security_master")
      .select("ticker, company_name, sector_etf, subsector_etfs")
      .in("ticker", needEnrich)
      .is("valid_to", null);
    if (data) {
      const updated = { ...metadataMap };
      (data as any[]).forEach((r) => {
        if (r.company_name && updated[r.ticker]) {
          updated[r.ticker] = {
            ...updated[r.ticker],
            name: r.company_name,
            sector_etf: r.sector_etf ?? updated[r.ticker].sector_etf,
            subsector_etf: r.subsector_etfs ?? updated[r.ticker].subsector_etf,
          };
        }
      });
      return updated;
    }
  } catch (_) {
    // Ignore
  }
  return metadataMap;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const arrayName = searchParams.get("array") || "ticker"; // 'ticker' | 'teo'
  const searchQuery = searchParams.get("search"); // Search by ticker or company name
  const mag7Only = searchParams.get("mag7") === "true"; // Limit to Magnificent 7 for landing page
  const origin = request.headers.get("origin");
  const includeMetadata = searchParams.get("include_metadata") === "true"; // Include company names and sectors

  // 0) Ticker search by name or symbol — shared DAL with chat tool search_tickers
  if (searchQuery) {
    try {
      const upperSearch = searchQuery.toUpperCase().trim();
      const rows = await searchTickers(searchQuery, true);

      if (rows.some((r) => r.ticker === upperSearch)) {
        return NextResponse.json(
          { ticker: upperSearch },
          {
            headers: {
              ...getCorsHeaders(origin),
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (rows.length > 0) {
        return NextResponse.json(
          {
            ticker: rows[0].ticker,
            suggestions: rows.map((m) => ({
              ticker: m.ticker,
              company_name: m.name || m.ticker,
              sector: m.sector,
            })),
          },
          {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json",
            },
          },
        );
      }

      return NextResponse.json(
        { ticker: upperSearch },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        },
      );
    } catch {
      return NextResponse.json(
        { ticker: searchQuery.toUpperCase().trim() },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        },
      );
    }
  }

  // 1) Ticker list
  if (arrayName === "ticker") {
    try {
      // Fast path: Return only Magnificent 7 for landing page (skip database queries)
      if (mag7Only) {
        const mag7Tickers = [
          "AAPL",
          "MSFT",
          "GOOGL",
          "AMZN",
          "NVDA",
          "META",
          "TSLA",
        ];

        // If metadata requested, fetch from symbols
        if (includeMetadata) {
          const { data: metadata, error: metaError } = await createAdminClient()
            .from("symbols")
            .select("ticker, metadata")
            .in("ticker", mag7Tickers);

          if (!metaError && metadata) {
            let metadataMap = Object.fromEntries(
              (metadata as any[]).map((m) => [
                m.ticker,
                {
                  name: m.metadata?.company_name || m.ticker,
                  sector: m.metadata?.sector || m.metadata?.gics_sector_name,
                  sector_etf: m.metadata?.sector_etf,
                  subsector_etf: m.metadata?.subsector_etf,
                },
              ]),
            );
            metadataMap = await enrichMetadataFromSecurityMaster(
              metadataMap,
              mag7Tickers,
            );

            return NextResponse.json(
              { tickers: mag7Tickers, metadata: metadataMap },
              {
                headers: {
                  ...getCorsHeaders(origin),
                  "Content-Type": "application/json",
                  "Cache-Control":
                    "public, s-maxage=300, stale-while-revalidate=600",
                },
              },
            );
          }
        }

        return NextResponse.json(
          { tickers: mag7Tickers },
          {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json",
              "Cache-Control":
                "public, s-maxage=300, stale-while-revalidate=600",
            },
          },
        );
      }

      const tickerSet = new Set<string>();

      // Primary source: symbols table
      try {
        const { data: symTickers, error: symError } = await createAdminClient()
          .from("symbols")
          .select("ticker");

        if (!symError && symTickers && symTickers.length > 0) {
          symTickers.forEach((row: any) => {
            if (row.ticker) tickerSet.add(row.ticker.toUpperCase().trim());
          });
        }
      } catch (error) {
        console.error("[Tickers API app] Exception fetching tickers:", error);
      }

      const tickers = Array.from(tickerSet).sort();

      // If metadata requested, fetch it
      if (includeMetadata && tickers.length > 0) {
        // Fetch metadata in batches to avoid query size limits
        const batchSize = 1000;
        let metadataMap: Record<string, any> = {};

        for (let i = 0; i < tickers.length; i += batchSize) {
          const batch = tickers.slice(i, i + batchSize);
          const { data: metadata, error: metaError } = await createAdminClient()
            .from("symbols")
            .select("ticker, metadata")
            .in("ticker", batch);

          if (!metaError && metadata) {
            (metadata as any[]).forEach((m) => {
              metadataMap[m.ticker] = {
                name: m.metadata?.company_name || m.ticker,
                sector: m.metadata?.sector || m.metadata?.gics_sector_name,
                sector_etf: m.metadata?.sector_etf,
                subsector_etf: m.metadata?.subsector_etf,
              };
            });
          }
        }

        metadataMap = await enrichMetadataFromSecurityMaster(
          metadataMap,
          tickers,
        );

        return NextResponse.json(
          { tickers, metadata: metadataMap },
          {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json",
              "Cache-Control":
                "public, s-maxage=300, stale-while-revalidate=600",
            },
          },
        );
      }

      return NextResponse.json(
        { tickers },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
            "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
          },
        },
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 },
      );
    }
  }

  // 2) Time index (teo) - prefer trading_calendar, fall back to symbols.latest_teo.
  // security_history is no longer a source as of the pure-Zarr SSOT cutover.
  try {
    let uniqueDates: string[] = [];

    const calendarDates = await fetchTradingCalendar("daily");
    if (calendarDates.length > 0) {
      uniqueDates = calendarDates;
    }

    if (uniqueDates.length === 0) {
      const { data: symbolDates } = (await (createAdminClient()
        .from("symbols")
        .select("latest_teo")
        .not("latest_teo", "is", null)
        .order("latest_teo", { ascending: true }) as any));

      if (symbolDates && (symbolDates as any[]).length > 0) {
        uniqueDates = Array.from(new Set((symbolDates as any[]).map((r: { latest_teo: string }) => r.latest_teo))).sort();
      }
    }

    if (uniqueDates.length === 0) {
      return NextResponse.json(
        { error: "No dates found in Supabase" },
        { status: 500 },
      );
    }
    const epoch2007 = new Date("2007-01-01").getTime();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const teo = uniqueDates.map((dateStr) => {
      const date = new Date(dateStr);
      return Math.floor((date.getTime() - epoch2007) / MS_PER_DAY);
    });

    return NextResponse.json(
      { teo },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
