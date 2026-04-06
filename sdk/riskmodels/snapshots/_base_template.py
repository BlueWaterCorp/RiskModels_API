"""Shared Jinja2 HTML base template for all PDF snapshots.

Extracted from BWMACRO/src/funds_dag/reporting/alpha_forensic.py (the reference
prototype). The CSS is the proven Consultant Navy layout — Letter Landscape,
0.45in margins, Navy header, chip bar, quadrant grid, footer.

Snapshot renderers (s1_forensic.py, s2_waterfall.py, etc.) extend BASE_HTML
by filling the Jinja2 blocks with their specific chart images.

Color constants are imported from visuals/styles.py — never hardcode here.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# The base HTML/CSS template.
# Jinja2 variables expected by all renderers:
#   ticker        — primary ticker string
#   report_title  — e.g. "S1 · Forensic Deep-Dive"
#   subtitle      — e.g. "NVIDIA Corp  ·  SMH Subsector  ·  L3 Risk Decomposition"
#   data_date     — ISO date string (TEO)
#   gen_date      — today's date
#   universe      — e.g. "uni_mc_3000"
#   chips         — list of {lbl, val} dicts for the metric strip
#   quadrants     — list of {title, chart_b64} dicts (each chart is base64 PNG)
#   confidential  — bool (default True)
# ---------------------------------------------------------------------------

BASE_HTML = """\
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>{{ report_title }} — {{ ticker }}</title>
  <style>
    @page {
      size: letter landscape;
      margin: 0.45in;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 9pt;
      color: #222;
      background: #f5f7fb;
    }

    /* ── Header ───────────────────────────────────── */
    .header {
      border-bottom: 3px solid #002a5e;
      padding-bottom: 8px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .header-left h1 {
      color: #002a5e;
      font-size: 17pt;
      font-weight: bold;
      line-height: 1.1;
    }
    .header-left h2 {
      color: #006f8e;
      font-size: 10pt;
      font-weight: normal;
      margin-top: 3px;
    }
    .header-right {
      text-align: right;
      font-size: 7.5pt;
      color: #888;
      line-height: 1.5;
    }
    .badge {
      display: inline-block;
      background: #002a5e;
      color: white;
      border-radius: 3px;
      padding: 1px 6px;
      font-size: 6.5pt;
      font-weight: bold;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    /* ── Metric chip bar ──────────────────────────── */
    .metrics-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .metric-chip {
      background: #eef2f7;
      border-radius: 4px;
      padding: 4px 9px;
      font-size: 7.5pt;
      min-width: 70px;
    }
    .metric-chip .val {
      color: #002a5e;
      font-weight: bold;
      font-size: 9.5pt;
      display: block;
    }
    .metric-chip .lbl {
      color: #888;
      display: block;
      font-size: 6.5pt;
      margin-top: 1px;
    }
    .metric-chip.highlight .val { color: #00AA00; }
    .metric-chip.warn .val      { color: #E07000; }

    /* ── Peer comparison chip (selection spread) ──── */
    .peer-chip {
      background: #002a5e;
      color: white;
      border-radius: 4px;
      padding: 4px 9px;
      font-size: 7.5pt;
    }
    .peer-chip .val {
      font-weight: bold;
      font-size: 9.5pt;
      display: block;
    }
    .peer-chip .lbl {
      opacity: 0.75;
      display: block;
      font-size: 6.5pt;
      margin-top: 1px;
    }

    /* ── Quadrant grid ────────────────────────────── */
    .quadrant-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .quadrant-row {
      display: flex;
      gap: 12px;
    }
    .quadrant {
      background: white;
      border: 1px solid #dde4f0;
      border-radius: 4px;
      padding: 10px;
      page-break-inside: avoid;
      flex: 1;
    }
    .quadrant.full-width {
      flex: none;
      width: 100%;
    }
    .quadrant-title {
      font-size: 8.5pt;
      font-weight: bold;
      color: #002a5e;
      border-bottom: 1.5px solid #002a5e;
      padding-bottom: 4px;
      margin-bottom: 8px;
    }
    img { max-width: 100%; height: auto; display: block; }

    /* ── Peer comparison table ────────────────────── */
    .peer-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5pt;
      margin-top: 6px;
    }
    .peer-table th {
      background: #002a5e;
      color: white;
      padding: 4px 6px;
      text-align: right;
      font-weight: bold;
    }
    .peer-table th:first-child { text-align: left; }
    .peer-table td {
      padding: 3px 6px;
      text-align: right;
      border-bottom: 1px solid #eef2f7;
    }
    .peer-table td:first-child { text-align: left; font-weight: bold; }
    .peer-table tr:nth-child(even) td { background: #f5f7fb; }
    .peer-table tr.target-row td { background: #eef2f7; font-weight: bold; }
    .positive { color: #00AA00; }
    .negative { color: #E07000; }

    /* ── Footer ───────────────────────────────────── */
    .footer {
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px solid #ccd5e0;
      font-size: 6.5pt;
      color: #aaa;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>{{ report_title }}</h1>
    <h2>{{ subtitle }}</h2>
  </div>
  <div class="header-right">
    {% if confidential %}<span class="badge">CONFIDENTIAL</span><br>{% endif %}
    Data as of: {{ data_date }}<br>
    Generated: {{ gen_date }}<br>
    Universe: {{ universe }}
  </div>
</div>

<div class="metrics-bar">
  {% for chip in chips %}
  <div class="metric-chip{% if chip.get('cls') %} {{ chip.cls }}{% endif %}">
    <span class="val">{{ chip.val }}</span>
    <span class="lbl">{{ chip.lbl }}</span>
  </div>
  {% endfor %}
  {% if peer_chip %}
  <div class="peer-chip">
    <span class="val">{{ peer_chip.val }}</span>
    <span class="lbl">{{ peer_chip.lbl }}</span>
  </div>
  {% endif %}
</div>

{{ body_html }}

<div class="footer">
  <div>ERM3 V3 · RiskModels API (riskmodels.app) · riskmodels-py {{ sdk_version }}</div>
  <div>L3 = 3-factor model (market / sector / sub-sector / residual). All ER values annualised.</div>
</div>

</body>
</html>
"""
