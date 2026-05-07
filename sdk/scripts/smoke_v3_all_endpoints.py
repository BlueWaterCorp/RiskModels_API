#!/usr/bin/env python3
"""
Smoke-test RiskModels API v3 operations from mcp/data/openapi.json.

Order: STOCKS (default ticker AAPL) -> FUNDS (symbol AGTHX -> bw_fund_id) -> PLATFORM.

Usage:
  export RISKMODELS_API_KEY=rm_agent_live_...
  python sdk/scripts/smoke_v3_all_endpoints.py

Optional:
  RISKMODELS_BASE_URL=https://riskmodels.app/api
  STOCK_TICKER=NVDA
  FUND_SEARCH=AGTHX
  SKIP_EXPENSIVE=1   # skips snapshot, PDFs, portfolio risk-snapshot, POST /batch/analyze
  SMOKE_REPORT_DIR=path/to/dir   # default: sdk/scripts/smoke_reports/<timestamp>
  SMOKE_WRITE_JSON=1             # write smoke_report.json (default 1)
  SMOKE_WRITE_PDF=1              # write smoke_report.pdf (default 1)
  SMOKE_JSON_BODY_MAX=32000       # max chars per response stored in reports (default 32000)
  SMOKE_PDF_BODY_MAX=3500        # max chars per endpoint in PDF appendix (default 3500)
  SMOKE_STREAM_MAX_BYTES=2097152 # max bytes read into memory per request (default 2MiB); larger bodies truncated
  SMOKE_SAVE_PDF_BYTES=0         # stream full API PDF responses to pdf_artifacts/ (default off — avoids huge RAM)
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import re
import sys
import textwrap
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = REPO_ROOT / "mcp" / "data" / "openapi.json"

STOCK_TICKER = os.environ.get("STOCK_TICKER", "AAPL").upper()
FUND_SEARCH = os.environ.get("FUND_SEARCH", "AGTHX").upper()
STYLE_SLUG = os.environ.get("STYLE_SLUG", "large-growth")
BASE = os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api").rstrip("/")
SITE = os.environ.get("RISKMODELS_SITE_ORIGIN", "https://riskmodels.app").rstrip("/")
_JSON_BODY_MAX = int(os.environ.get("SMOKE_JSON_BODY_MAX", "32000"))
_PDF_BODY_MAX = int(os.environ.get("SMOKE_PDF_BODY_MAX", "3500"))
_STREAM_MAX_BYTES = int(os.environ.get("SMOKE_STREAM_MAX_BYTES", str(2 * 1024 * 1024)))


def load_env_files() -> None:
    """Populate os.environ from local .env files if keys are not already set."""
    candidates = [
        REPO_ROOT / ".env",
        REPO_ROOT / ".env.local",
        REPO_ROOT.parent / "BWMACRO" / ".env",
        REPO_ROOT.parent / "BWMACRO" / "web" / ".env.local",
    ]
    for p in candidates:
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


@dataclass
class Row:
    group: str
    method: str
    path: str
    status: int | None
    ok: bool
    note: str = ""
    snippet: str = ""


@dataclass
class CallRecord:
    """One HTTP call — full enough for JSON export; PDF uses shorter excerpt."""

    group: str
    method: str
    path_template: str
    url: str
    status: int | None
    ok: bool
    note: str
    content_type: str
    body_kind: str  # json | text | binary_pdf | empty | error | skip
    body_text: str  # truncated for storage
    bytes_len: int | None = None
    error: str | None = None


@dataclass
class Run:
    rows: list[Row] = field(default_factory=list)

    def add(self, r: Row) -> None:
        self.rows.append(r)


def _snippet(text: str, n: int = 200) -> str:
    text = text.replace("\n", " ")
    return text[:n] + ("..." if len(text) > n else "")


def classify_path(path: str) -> str:
    if "/data/funds" in path or path.startswith("/funds"):
        return "funds"
    if path.startswith("/.well-known"):
        return "platform"
    stock_markers = (
        "{ticker}",
        "/metrics/",
        "/ticker-returns",
        "/returns",
        "/etf-returns",
        "/decompose",
        "/l3-decomposition",
        "/correlation",
        "/batch/analyze",
        "/portfolio/",
        "/snapshot",
        "/rankings/",
    )
    if any(m in path for m in stock_markers):
        return "stocks"
    return "platform"


def expand_path(path: str, *, stock: str, bw_fund_id: str, slug: str) -> str:
    out = path
    out = out.replace("{ticker}", quote(stock, safe=""))
    out = out.replace("{bw_fund_id}", quote(bw_fund_id, safe=""))
    out = out.replace("{slug}", quote(slug, safe=""))
    out = out.replace("{cohort_type}", "fund")
    return out


def url_for_path(path: str) -> str:
    if path.startswith("/.well-known"):
        return SITE + path
    return BASE + path


def should_skip(skip_expensive: bool, method: str, path: str) -> tuple[bool, str]:
    if path in ("/auth/provision", "/auth/provision-free"):
        return True, "skip mutating auth provision"
    if path == "/chat" and os.environ.get("RUN_CHAT", "").lower() not in ("1", "true", "yes"):
        return True, "skip LLM spend (set RUN_CHAT=1 to enable)"
    if path == "/webhooks/subscribe":
        return True, "skip webhook subscription lifecycle"
    if path.startswith("/plaid/"):
        return True, "skip Plaid (needs user session)"
    if method == "patch" and path in ("/balance", "/user/billing-config"):
        return True, "skip mutating PATCH"
    if method == "get" and path == "/mcp/sse":
        return True, "skip streaming GET (use POST tools/list below)"
    if skip_expensive and path in (
        "/snapshot",
        "/portfolio/risk-snapshot",
        "/batch/analyze",
    ):
        return True, "SKIP_EXPENSIVE"
    if skip_expensive and path.endswith("/snapshot.pdf"):
        return True, "SKIP_EXPENSIVE"
    if skip_expensive and "/snapshot.pdf" in path:
        return True, "SKIP_EXPENSIVE"
    return False, ""


def json_body(method: str, path: str, *, stock: str, bw_fund_id: str) -> dict[str, Any] | None:
    if method != "post":
        return None
    if path == "/decompose":
        return {"ticker": stock}
    if path == "/correlation":
        return {"ticker": stock, "factors": ["vix_spot"], "years": 1}
    if path == "/batch/analyze":
        return {"tickers": [stock], "metrics": ["full_metrics"], "years": 1, "format": "json"}
    if path == "/portfolio/risk-index":
        return {"positions": [{"ticker": stock, "weight": 1.0}], "timeSeries": False}
    if path == "/portfolio/risk-snapshot":
        return {"positions": [{"ticker": stock, "weight": 1.0}], "format": "json"}
    if path == "/snapshot":
        return {"type": "ticker", "ticker": stock, "lookback_days": 60}
    if path == "/data/funds/batch":
        return {"fund_ids": [bw_fund_id]}
    if path == "/estimate":
        return {"endpoint": "ticker-returns", "params": {"ticker": stock, "years": 1}}
    if path == "/cli/query":
        return {"sql": f"SELECT ticker, symbol FROM symbols WHERE ticker = '{stock}' LIMIT 1", "limit": 10}
    if path == "/mcp/sse":
        return {"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}
    if path == "/auth/token":
        return {}  # caller handles skip if no oauth
    return None


def query_for(method: str, path: str, *, stock: str, bw_fund_id: str, slug: str) -> dict[str, str]:
    q: dict[str, str] = {}
    if path == "/ticker-returns":
        q["ticker"] = stock
        q["years"] = "1"
    if path == "/returns":
        q["ticker"] = stock
    if path == "/etf-returns":
        q["ticker"] = "SPY"
        q["years"] = "1"
    if path == "/l3-decomposition":
        q["ticker"] = stock
        q["years"] = "1"
    if path == "/macro-factors":
        q["years"] = "1"
    if path == "/rankings/top":
        q["cohort"] = "universe"
        q["window"] = "252d"
        q["metric"] = "mkt_cap"
        q["limit"] = "5"
    if path == "/tickers":
        q["limit"] = "5"
    if path == "/telemetry":
        q["days"] = "1"
    if path == "/data/funds/search":
        q["q"] = FUND_SEARCH
        q["limit"] = "5"
    if path == "/funds/style/{slug}/rankings/{cohort_type}":
        q["metric"] = "gross_return"
        q["period_window"] = "12m"
        q["limit"] = "5"
    if path == "/metrics/{ticker}/correlation":
        q["factors"] = "vix_spot"
        q["years"] = "1"
    return q


def resolve_fund_id() -> str:
    """Fund search is public (Bearer optional); avoid sending a bad token (401)."""
    env_id = os.environ.get("FUND_BW_FUND_ID", "").strip()
    if env_id:
        return env_id
    r = httpx.get(
        url_for_path("/data/funds/search"),
        params={"q": FUND_SEARCH, "limit": "10"},
        timeout=60.0,
    )
    r.raise_for_status()
    data = r.json()
    results = data.get("results") or []
    for row in results:
        tid = (row.get("ticker") or "").upper()
        if tid == FUND_SEARCH or FUND_SEARCH in tid:
            fid = row.get("bw_fund_id")
            if fid:
                return str(fid)
    if results:
        fid = results[0].get("bw_fund_id")
        if fid:
            return str(fid)
    raise RuntimeError(f"No fund found for search {FUND_SEARCH!r}: {data}")


def _safe_filename(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", s)[:120]


def _excerpt_from_bytes(
    raw: bytes,
    *,
    content_type: str,
    max_chars: int,
    total_len: int,
    truncated_read: bool,
) -> tuple[str, str, int]:
    """Returns (body_kind, body_text, bytes_len)."""
    ct = (content_type or "").split(";")[0].strip().lower()
    blen = total_len
    if ct == "application/pdf" or (raw and raw[:4] == b"%PDF"):
        return "binary_pdf", f"<application/pdf {blen} bytes — not inlined>", blen

    text = raw.decode("utf-8", errors="replace")
    if not text.strip():
        return "empty", "", blen

    kind = "text"
    pretty = text
    if "json" in ct or text.lstrip().startswith(("{", "[")):
        try:
            obj = json.loads(text)
            pretty = json.dumps(obj, indent=2, default=str)
            kind = "json"
        except json.JSONDecodeError:
            pretty = text
            kind = "text"

    suffix = ""
    if truncated_read:
        suffix = f"\n\n… HTTP body truncated at {_STREAM_MAX_BYTES} bytes read (SMOKE_STREAM_MAX_BYTES)"
    if len(pretty) > max_chars:
        pretty = pretty[:max_chars] + f"\n\n… excerpt max chars ({max_chars}, SMOKE_JSON_BODY_MAX)" + suffix
    elif suffix:
        pretty = pretty + suffix
    return kind, pretty, blen


def _smoke_http(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None,
    json_data: Any | None,
    pdf_out: Path | None,
) -> tuple[int, str, str, str, int]:
    """
    Memory-safe: streams body. PDF responses are drained without buffering unless pdf_out is set
    (then the full file is written chunk-by-chunk to disk).
    """
    with client.stream(method.upper(), url, headers=headers or None, json=json_data) as r:
        status = r.status_code
        ct = (r.headers.get("content-type") or "").split(";")[0].strip()

        it = r.iter_bytes()
        first = next(it, b"")
        total = len(first)

        want_save = (
            pdf_out is not None
            and status == 200
            and ("pdf" in ct.lower() or first.startswith(b"%PDF"))
        )
        if want_save and pdf_out is not None:
            pdf_out.parent.mkdir(parents=True, exist_ok=True)
            with open(pdf_out, "wb") as f:
                f.write(first)
                for ch in it:
                    total += len(ch)
                    f.write(ch)
            return status, ct, "binary_pdf", f"<application/pdf {total} bytes → {pdf_out.name}>", total

        is_pdf = "pdf" in ct.lower() or first.startswith(b"%PDF")
        if is_pdf:
            for ch in it:
                total += len(ch)
            return status, ct, "binary_pdf", f"<application/pdf {total} bytes — not stored>", total

        buf = bytearray(first)
        for ch in it:
            total += len(ch)
            if len(buf) < _STREAM_MAX_BYTES:
                need = _STREAM_MAX_BYTES - len(buf)
                buf.extend(ch[:need])

        truncated = total > len(buf)
        kind, text, blen = _excerpt_from_bytes(
            bytes(buf),
            content_type=ct,
            max_chars=_JSON_BODY_MAX,
            total_len=total,
            truncated_read=truncated,
        )
        return status, ct, kind, text, blen


def write_json_report(path: Path, meta: dict[str, Any], records: list[CallRecord]) -> None:
    payload = {
        "meta": meta,
        "calls": [asdict(c) for c in records],
    }
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def _mpl_plain(s: str) -> str:
    """Matplotlib interprets $ as math; escape for fig.text."""
    return (s or "").replace("$", r"\$")


def _wrap_body_for_pdf(text: str, width: int = 105) -> list[str]:
    lines: list[str] = []
    for para in (text or "").splitlines():
        lines.extend(textwrap.wrap(para, width=width, replace_whitespace=False) or [""])
    return lines if lines else ["(no body)"]


def write_pdf_report(path: Path, meta: dict[str, Any], records: list[CallRecord]) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages

    title = meta.get("title", "RiskModels API v3 smoke report")
    max_lines = 82
    page_count = 0
    with PdfPages(path) as pdf:
        # Cover
        fig = plt.figure(figsize=(8.5, 11))
        fig.text(0.08, 0.92, _mpl_plain(title), fontsize=14, weight="bold", transform=fig.transFigure)
        y = 0.86
        for line in (
            f"Generated: {meta.get('generated_utc', '')}",
            f"Base: {meta.get('base', '')}",
            f"Stock: {meta.get('stock_ticker', '')}  Fund search: {meta.get('fund_search', '')}  bw_fund_id: {meta.get('bw_fund_id', '')}",
            f"SKIP_EXPENSIVE: {meta.get('skip_expensive', False)}",
            "Full response bodies: smoke_report.json in the same folder.",
        ):
            fig.text(0.08, y, _mpl_plain(line), fontsize=9, transform=fig.transFigure, family="monospace")
            y -= 0.035
        pdf.savefig(fig)
        plt.close(fig)
        del fig
        page_count += 1

        for rec in records:
            sub = rec.body_text[:_PDF_BODY_MAX]
            if len(rec.body_text) > _PDF_BODY_MAX:
                sub += f"\n\n… PDF excerpt truncated ({len(rec.body_text)} chars in JSON report)"
            all_lines = _wrap_body_for_pdf(sub)
            chunks: list[list[str]] = []
            for i in range(0, len(all_lines), max_lines):
                chunk = all_lines[i : i + max_lines]
                if i + max_lines < len(all_lines):
                    chunk = chunk + [f"… continued ({len(all_lines) - i - max_lines} lines left → JSON)"]
                chunks.append(chunk)
            if not chunks:
                chunks = [["(no body)"]]

            for page_i, chunk in enumerate(chunks):
                fig = plt.figure(figsize=(8.5, 11))
                header = f"{rec.method.upper()} {rec.path_template}  →  {rec.status}  {'OK' if rec.ok else 'FAIL'}"
                if rec.note:
                    header += f"  |  {rec.note}"
                if len(chunks) > 1:
                    header += f"  (page {page_i + 1}/{len(chunks)})"
                fig.text(0.06, 0.96, _mpl_plain(header), fontsize=9, weight="bold", transform=fig.transFigure, family="monospace")
                fig.text(
                    0.06,
                    0.925,
                    _mpl_plain(rec.url[:200] + ("…" if len(rec.url) > 200 else "")),
                    fontsize=6,
                    transform=fig.transFigure,
                    family="monospace",
                )
                body_block = "\n".join(_mpl_plain(x) for x in chunk)
                fig.text(
                    0.06,
                    0.88,
                    body_block,
                    fontsize=5.5,
                    verticalalignment="top",
                    transform=fig.transFigure,
                    family="monospace",
                )
                if rec.body_kind == "binary_pdf" and rec.bytes_len:
                    fig.text(
                        0.06,
                        0.04,
                        _mpl_plain(
                            f"Binary PDF ({rec.bytes_len} bytes). Full file: see JSON + optional SMOKE_SAVE_PDF_BYTES."
                        ),
                        fontsize=8,
                        transform=fig.transFigure,
                    )
                pdf.savefig(fig)
                plt.close(fig)
                del fig
                page_count += 1
                if page_count % 25 == 0:
                    gc.collect()


def is_bug(row: Row) -> bool:
    """Heuristic: unexpected failures worth surfacing in the smoke summary (not skips/auth noise)."""
    if row.note.startswith("skip") or "SKIP_EXPENSIVE" in row.note:
        return False
    if row.status is None:
        return True
    if row.status >= 500:
        return True
    if row.status == 401:
        return False
    if row.status == 402:
        return False
    if row.status == 429:
        return False
    if row.path == "/returns" and row.status == 404:
        return False  # deprecated route (often Next HTML 404)
    if row.status == 501 and "png" in row.path:
        return False
    if row.status == 404 and row.snippet.startswith("{") and "No " in row.snippet:
        return False  # explicit data-unavailable JSON from API
    if row.status in (400, 404, 422) and row.group in ("stocks", "funds"):
        return True
    if row.status == 400 and row.group == "platform":
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test OpenAPI v3 paths against live API.")
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Skip expensive calls (snapshot, PDFs, portfolio risk-snapshot, batch/analyze).",
    )
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=None,
        help="Directory for smoke_report.json, smoke_report.pdf, optional PDF artifacts.",
    )
    parser.add_argument("--no-json", action="store_true", help="Do not write smoke_report.json")
    parser.add_argument("--no-pdf", action="store_true", help="Do not write smoke_report.pdf")
    args = parser.parse_args()

    load_env_files()
    api_key = os.environ.get("RISKMODELS_API_KEY")

    spec = json.loads(OPENAPI_PATH.read_text())
    paths: dict[str, Any] = spec.get("paths") or {}

    if not api_key:
        print("ERROR: Set RISKMODELS_API_KEY", file=sys.stderr)
        return 2

    skip_expensive = args.quick or os.environ.get("SKIP_EXPENSIVE", "").lower() in ("1", "true", "yes")
    report_dir = args.report_dir
    if report_dir is None:
        raw = os.environ.get("SMOKE_REPORT_DIR", "").strip()
        report_dir = Path(raw) if raw else REPO_ROOT / "sdk" / "scripts" / "smoke_reports" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_dir.mkdir(parents=True, exist_ok=True)
    write_json = not args.no_json and os.environ.get("SMOKE_WRITE_JSON", "1").lower() not in ("0", "false", "no")
    write_pdf = not args.no_pdf and os.environ.get("SMOKE_WRITE_PDF", "1").lower() not in ("0", "false", "no")
    save_pdf_bytes = os.environ.get("SMOKE_SAVE_PDF_BYTES", "").lower() in ("1", "true", "yes")

    run = Run()
    records: list[CallRecord] = []
    headers = {"Authorization": f"Bearer {api_key}"}

    timeout = httpx.Timeout(180.0, connect=30.0)
    with httpx.Client(headers=headers, timeout=timeout) as client:
        try:
            bw_fund_id = resolve_fund_id()
        except Exception as exc:
            print(f"ERROR resolving fund {FUND_SEARCH}: {exc}", file=sys.stderr)
            return 3

        operations: list[tuple[str, str, str]] = []
        for path, entry in sorted(paths.items()):
            for method, op in entry.items():
                if method == "parameters":
                    continue
                if not isinstance(op, dict):
                    continue
                m = method.lower()
                if m not in ("get", "post", "patch", "put", "delete"):
                    continue
                grp = classify_path(path)
                operations.append((grp, m, path))

        order = {"stocks": 0, "funds": 1, "platform": 2}
        operations.sort(key=lambda x: (order.get(x[0], 9), x[2], x[1]))

        for grp, method, path in operations:
            skip, why = should_skip(skip_expensive, method, path)
            if skip:
                run.add(Row(grp, method, path, None, True, why))
                records.append(
                    CallRecord(
                        grp,
                        method,
                        path,
                        "",
                        None,
                        True,
                        why,
                        "",
                        "skip",
                        why,
                        None,
                        None,
                    )
                )
                continue
            if path == "/auth/token":
                msg = "skip OAuth token (needs RISKMODELS_CLIENT_ID / RISKMODELS_CLIENT_SECRET)"
                run.add(Row(grp, method, path, None, True, msg))
                records.append(
                    CallRecord(grp, method, path, "", None, True, msg, "", "skip", msg, None, None)
                )
                continue

            expanded = expand_path(path, stock=STOCK_TICKER, bw_fund_id=bw_fund_id, slug=STYLE_SLUG)
            url = url_for_path(expanded)
            params = query_for(method, path, stock=STOCK_TICKER, bw_fund_id=bw_fund_id, slug=STYLE_SLUG)
            if params:
                url = url + ("&" if "?" in url else "?") + urlencode(params)
            body = json_body(method, path, stock=STOCK_TICKER, bw_fund_id=bw_fund_id)
            mcp_extra: dict[str, str] = {}
            if path == "/mcp/sse" and method == "post":
                mcp_extra["Accept"] = "application/json, text/event-stream"
            req_headers = {**mcp_extra}

            pdf_path: Path | None = None
            if save_pdf_bytes and method == "get" and ("/snapshot.pdf" in path or path.endswith("snapshot.pdf")):
                art_dir = report_dir / "pdf_artifacts"
                art_dir.mkdir(parents=True, exist_ok=True)
                fn = f"{method.upper()}_{_safe_filename(expanded)}.pdf"
                pdf_path = art_dir / fn

            json_payload: Any | None = None
            if method == "post":
                json_payload = body if body is not None else {}
            elif method == "patch":
                json_payload = body if body is not None else {}

            try:
                status, ct, kind, excerpt, blen = _smoke_http(
                    client,
                    method,
                    url,
                    headers=req_headers or None,
                    json_data=json_payload,
                    pdf_out=pdf_path,
                )
                ok = 200 <= status < 300 or status == 304
                note_after = ""
                if path in ("/returns", "/etf-returns") and status == 410:
                    ok = True
                    note_after = "expected deprecated (410 Gone JSON)"
                if kind == "binary_pdf":
                    ok = ok and status == 200 and blen > 100
                run.add(
                    Row(
                        grp,
                        method,
                        path,
                        status,
                        ok,
                        note_after,
                        snippet=_snippet(excerpt) if not ok and excerpt else "",
                    )
                )
                records.append(
                    CallRecord(
                        grp,
                        method,
                        path,
                        url,
                        status,
                        ok,
                        note_after,
                        ct,
                        kind,
                        excerpt,
                        blen,
                        None,
                    )
                )
            except httpx.HTTPError as exc:
                err = f"{type(exc).__name__}: {exc}"
                run.add(Row(grp, method, path, None, False, type(exc).__name__, str(exc)))
                records.append(
                    CallRecord(
                        grp,
                        method,
                        path,
                        url,
                        None,
                        False,
                        type(exc).__name__,
                        "",
                        "error",
                        "",
                        None,
                        err,
                    )
                )

    meta = {
        "title": "RiskModels API v3 smoke report",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "base": BASE,
        "site": SITE,
        "stock_ticker": STOCK_TICKER,
        "fund_search": FUND_SEARCH,
        "bw_fund_id": bw_fund_id,
        "style_slug": STYLE_SLUG,
        "skip_expensive": skip_expensive,
        "openapi_path": str(OPENAPI_PATH),
        "stream_max_bytes": _STREAM_MAX_BYTES,
        "json_body_max_chars": _JSON_BODY_MAX,
    }
    if write_json:
        write_json_report(report_dir / "smoke_report.json", meta, records)
    if write_pdf:
        write_pdf_report(report_dir / "smoke_report.pdf", meta, records)

    # Report
    print(f"BASE={BASE} SITE={SITE} STOCK={STOCK_TICKER} FUND_SEARCH={FUND_SEARCH} bw_fund_id={bw_fund_id}")
    print(f"skip_expensive={skip_expensive}")
    if write_json or write_pdf:
        print(f"Report dir: {report_dir.resolve()}")
        if write_json:
            print(f"  JSON: {report_dir / 'smoke_report.json'}")
        if write_pdf:
            print(f"  PDF:  {report_dir / 'smoke_report.pdf'}")
        if save_pdf_bytes:
            print(f"  PDF response bytes: {report_dir / 'pdf_artifacts'}/")
    print()

    current = None
    for row in run.rows:
        if row.group != current:
            current = row.group
            print(f"\n=== {current.upper()} ===")
        status = row.status if row.status is not None else "ERR"
        flag = "OK " if row.ok else "FAIL"
        extra = f" | {row.note}" if row.note else ""
        if row.snippet:
            extra += f" | {row.snippet}"
        print(f"{flag} {row.method.upper():6} {status!s:>4} {row.path}{extra}")

    bugs = [r for r in run.rows if is_bug(r)]
    print("\n--- Likely product bugs (non-skip, unexpected 4xx/5xx or transport) ---")
    if not bugs:
        print("(none)")
    else:
        for r in bugs:
            print(f"- {r.method.upper()} {r.path} -> {r.status} {r.note} {r.snippet}".strip())

    fails = [r for r in run.rows if not r.ok and not r.note.startswith("skip") and "SKIP_EXPENSIVE" not in r.note]
    critical = [r for r in fails if not r.path.startswith("/.well-known/")]
    return 1 if critical else 0


if __name__ == "__main__":
    raise SystemExit(main())
