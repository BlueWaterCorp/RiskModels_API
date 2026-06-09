#!/usr/bin/env python3
"""backfill_activation.py — one-off: repair first_api_use_at from billing_events.

The fire-and-forget activation stamp in lib/agent/api-keys.ts silently lost most
real activations on serverless (only 1 of 8 real callers got stamped). billing_events
is the reliable record of first API use, so backfill agent_accounts.signup_attribution
.first_api_use_at = MIN(billing_events.created_at) for any account that has calls but
no stamp.

Run under Doppler erm3/prd (SUPABASE_URL + service-role key):
  doppler run -p erm3 -c prd -- python scripts/backfill_activation.py            # dry-run
  doppler run -p erm3 -c prd -- python scripts/backfill_activation.py --apply     # write
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import httpx


def _creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_KEY")
    )
    if not url or not key:
        print("SUPABASE_URL / service key not set", file=sys.stderr)
        sys.exit(2)
    return url.rstrip("/"), key


def _sa(row: dict) -> dict:
    s = row.get("signup_attribution")
    if isinstance(s, str):
        try:
            s = json.loads(s)
        except ValueError:
            s = {}
    return s if isinstance(s, dict) else {}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    args = ap.parse_args()
    url, key = _creds()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}

    # earliest call per user from billing_events
    be = httpx.get(
        f"{url}/rest/v1/billing_events",
        params={"select": "user_id,created_at", "limit": "100000"},
        headers=h,
        timeout=60.0,
    ).json()
    first_call: dict[str, str] = {}
    for r in be:
        uid, ts = r.get("user_id"), r.get("created_at")
        if not uid or not ts:
            continue
        if uid not in first_call or ts < first_call[uid]:
            first_call[uid] = ts

    accounts = httpx.get(
        f"{url}/rest/v1/agent_accounts",
        params={"select": "id,user_id,signup_attribution", "limit": "50000"},
        headers=h,
        timeout=60.0,
    ).json()

    todo = []
    for a in accounts:
        uid = a.get("user_id")
        sa = _sa(a)
        if uid in first_call and not sa.get("first_api_use_at"):
            todo.append((a["id"], uid, sa, first_call[uid]))

    print(f"accounts with calls but no first_api_use_at: {len(todo)}")
    for _id, uid, _sa_, ts in todo:
        print(f"  {uid[:8]}…  ->  first_api_use_at = {ts}")

    if not args.apply:
        print("\nDRY RUN — re-run with --apply to write.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    patched = 0
    for _id, uid, sa, ts in todo:
        body = {"signup_attribution": {**sa, "first_api_use_at": ts}, "updated_at": now}
        resp = httpx.patch(
            f"{url}/rest/v1/agent_accounts",
            params={"id": f"eq.{_id}"},
            headers={**h, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json=body,
            timeout=30.0,
        )
        if resp.status_code < 300:
            patched += 1
        else:
            print(f"  FAIL {uid[:8]}…: [{resp.status_code}] {resp.text[:160]}", file=sys.stderr)
    print(f"\nPatched {patched}/{len(todo)} accounts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
