type NumberMap = Record<string, number | null | undefined>;

type Holding = {
  security_id?: string;
  ticker?: string | null;
  name?: string | null;
  weight?: number | null;
  adj_mv?: number | null;
};

export type FilerSnapshot = {
  bw_filer_id?: string;
  cik?: string | null;
  name?: string | null;
  filer_type?: string | null;
  report_date?: string | null;
  filing_date?: string | null;
  metrics?: NumberMap & {
    total_aum_usd?: number | null;
    n_holdings_active?: number | null;
    effective_n?: number | null;
    top10_weight_sum?: number | null;
    model_version?: string | null;
  };
  holdings?: { n_total_holdings?: number; top?: Holding[] } | null;
  coverage?: {
    coverage_in_erm3?: number | null;
    aum_in_erm3?: number | null;
  };
  erm3_decomposition?: {
    monthly_returns?: Array<{ teo?: string | null }>;
    variance_shares_full?: NumberMap | null;
    variance_shares_recent?: NumberMap | null;
    waterfall_latest_month?: NumberMap | null;
  } | null;
  _metadata?: {
    model_version?: string | null;
    factor_set_id?: string | null;
    data_as_of?: string | null;
  };
};

const PALETTES = {
  dark: {
    background: "#071820",
    card: "#102832",
    text: "#edf6f8",
    muted: "#9eb6bf",
    border: "#294651",
    accent: "#5cc8a1",
  },
  light: {
    background: "#f7fafb",
    card: "#ffffff",
    text: "#18323d",
    muted: "#5b737d",
    border: "#cddde2",
    accent: "#087f5b",
  },
} as const;

const LAYERS = ["market", "sector", "subsector", "style", "residual"] as const;

export function renderManagerSkillReview(
  snapshot: FilerSnapshot,
  requestedTheme: string | null,
): string {
  const theme = requestedTheme === "light" ? "light" : "dark";
  const c = PALETTES[theme];
  const metrics = snapshot.metrics ?? {};
  const full = snapshot.erm3_decomposition?.variance_shares_full ?? null;
  const recent = snapshot.erm3_decomposition?.variance_shares_recent ?? null;
  const latest = snapshot.erm3_decomposition?.waterfall_latest_month ?? null;
  const monthlyRows = snapshot.erm3_decomposition?.monthly_returns ?? [];
  const latestMonth = monthlyRows.at(-1)?.teo ?? snapshot.report_date ?? null;
  const holdings = snapshot.holdings?.top?.slice(0, 10) ?? [];

  const cards = [
    ["Filed equity value", money(metrics.total_aum_usd)],
    ["Reported holdings", integer(snapshot.holdings?.n_total_holdings ?? metrics.n_holdings_active)],
    ["Effective holdings", decimal(metrics.effective_n, 1)],
    ["Top 10 weight", percent(metrics.top10_weight_sum)],
    ["ERM3 coverage", percent(snapshot.coverage?.coverage_in_erm3)],
  ];

  const cardHtml = cards
    .map(
      ([label, value]) =>
        `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`,
    )
    .join("");

  const riskRows = LAYERS.map((layer) => [
    title(layer),
    percent(full?.[layer]),
    percent(recent?.[layer]),
    percent(latest?.[`portfolio_${layer === "residual" ? "idiosyncratic" : layer}_return`]),
  ]);

  const holdingRows = holdings.map((holding) => [
    holding.ticker || holding.security_id || "—",
    holding.name || "—",
    percent(holding.weight),
    money(holding.adj_mv),
  ]);

  const provenance = [
    ["Evidence", "SEC 13F reported holdings"],
    ["Report date", snapshot.report_date || snapshot._metadata?.data_as_of || "Unavailable"],
    ["Filed date", snapshot.filing_date || "Unavailable"],
    ["Model", snapshot._metadata?.model_version || metrics.model_version || "Unavailable"],
    ["Factor set", snapshot._metadata?.factor_set_id || "Unavailable"],
    ["Filer ID", snapshot.bw_filer_id || "Unavailable"],
  ];

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: ${theme}; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; background: ${c.background}; color: ${c.text}; font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  h1, h2 { margin: 0; }
  h1 { font-size: 23px; }
  h2 { font-size: 15px; margin-bottom: 10px; }
  .eyebrow { color: ${c.accent}; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .subtitle, .note { color: ${c.muted}; }
  .subtitle { margin: 4px 0 16px; }
  .note { font-size: 12px; margin-top: 8px; }
  .cards { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 10px; }
  .card, .panel { background: ${c.card}; border: 1px solid ${c.border}; border-radius: 10px; }
  .card { padding: 12px; }
  .label { color: ${c.muted}; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .value { margin-top: 3px; font-size: 19px; font-weight: 650; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .panel { padding: 14px; overflow: auto; }
  .wide { grid-column: 1 / -1; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 8px; border-bottom: 1px solid ${c.border}; text-align: left; white-space: nowrap; }
  th { color: ${c.muted}; font-size: 11px; text-transform: uppercase; letter-spacing: .035em; }
  td:nth-child(n+3), th:nth-child(n+3) { text-align: right; }
  .provenance td:first-child { color: ${c.muted}; }
  .provenance td:nth-child(2) { text-align: left; }
  @media (max-width: 900px) { .cards { grid-template-columns: repeat(2, 1fr); } .grid { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
</style>
</head>
<body>
  <div class="eyebrow">Manager Skill Review · public filing evidence</div>
  <h1>${escapeHtml(snapshot.name || "13F filer")}</h1>
  <div class="subtitle">${escapeHtml(humanize(snapshot.filer_type || "13F filer"))} · CIK ${escapeHtml(snapshot.cik || "unavailable")}</div>
  <div class="cards">${cardHtml}</div>
  <div class="grid">
    <section class="panel">
      <h2>Risk decomposition and latest return attribution</h2>
      ${table(["Layer", "Full history risk", "Recent risk", latestMonth ? `Return · ${latestMonth}` : "Latest month return"], riskRows)}
      <div class="note">Risk shares describe exposure. They are not a performance ranking.</div>
    </section>
    <section class="panel">
      <h2>Evidence and provenance</h2>
      ${table(["Field", "Value"], provenance, "provenance")}
      <div class="note">Backward-looking review of reported holdings. No manager rank or forecast is shown.</div>
    </section>
    <section class="panel wide">
      <h2>Largest reported holdings</h2>
      ${holdingRows.length ? table(["Ticker", "Security", "Weight", "Filed value"], holdingRows) : `<div class="note">Holdings are unavailable for this filer.</div>`}
    </section>
  </div>
</body>
</html>`;
}

function table(headers: string[], rows: string[][], className = ""): string {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table${className ? ` class="${className}"` : ""}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function humanize(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map(title)
    .join(" ");
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percent(value: unknown): string {
  const number = finite(value);
  return number === null ? "—" : `${(number * 100).toFixed(1)}%`;
}

function money(value: unknown): string {
  const number = finite(value);
  if (number === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

function integer(value: unknown): string {
  const number = finite(value);
  return number === null ? "—" : Math.round(number).toLocaleString("en-US");
}

function decimal(value: unknown, digits: number): string {
  const number = finite(value);
  return number === null ? "—" : number.toFixed(digits);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
