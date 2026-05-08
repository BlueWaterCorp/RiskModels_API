/**
 * J.12 — Monthly snapshot digest (scaffolding).
 * Phase 1 will: resolve tickers → PDF URLs, attach via Resend, populate highlights from live metrics.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { SnapshotDigestEmailProps } from "@/emails/snapshot-digest";
import { BASE_URL } from "@/emails/constants";

export type UserEmailPreferencesRow = {
  user_id: string;
  digest_enabled: boolean;
  watch_tickers: string[] | null;
  fund_company_slugs: string[] | null;
  frequency: "monthly" | "biweekly";
  last_digest_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

const supabase = () => createAdminClient();

/** Load preferences for one user (service role). */
export async function loadUserEmailPreferences(
  userId: string,
): Promise<UserEmailPreferencesRow | null> {
  const { data, error } = await supabase()
    .from("user_email_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[snapshot-digest] loadUserEmailPreferences:", error.message);
    return null;
  }
  return data as UserEmailPreferencesRow | null;
}

/**
 * Users with digest_enabled and at least one watch ticker or fund company slug.
 * Does not evaluate calendar cadence — caller should filter by frequency + last_digest_sent_at.
 */
export async function listDigestSubscriberUserIds(): Promise<string[]> {
  const { data, error } = await supabase()
    .from("user_email_preferences")
    .select("user_id")
    .eq("digest_enabled", true);

  if (error) {
    console.error("[snapshot-digest] listDigestSubscriberUserIds:", error.message);
    return [];
  }

  const rows = (data ?? []) as Pick<UserEmailPreferencesRow, "user_id">[];
  return rows.map((r) => r.user_id);
}

/**
 * Map DB row + profile display name → React Email props (placeholder highlights until PDF pipeline lands).
 */
export function buildSnapshotDigestEmailProps(args: {
  userName: string;
  periodLabel: string;
  prefs: UserEmailPreferencesRow;
}): SnapshotDigestEmailProps {
  const tickers = args.prefs.watch_tickers ?? [];
  const items: SnapshotDigestEmailProps["items"] = tickers.slice(0, 5).map((t) => {
    const ticker = t.trim().toUpperCase();
    return {
      label: ticker,
      kind: "stock" as const,
      reportId: "R1",
      highlight:
        "Factor risk summary and hedge ratios (full PDF attaches in Phase 1 — this send is template validation).",
      interactiveUrl: `${BASE_URL}/metrics/${encodeURIComponent(ticker)}`,
    };
  });

  const exec =
    tickers.length > 0
      ? `Watchlist: ${tickers.slice(0, 5).join(", ")} — snapshot links below.`
      : "Your digest is configured; add tickers or fund families in settings to personalize.";

  const issueLabel =
    tickers.length > 0
      ? `${args.periodLabel} · Watchlist (${Math.min(tickers.length, 5)} names)`
      : args.periodLabel;

  return {
    userName: args.userName,
    periodLabel: args.periodLabel,
    issueLabel,
    executiveSummary: exec,
    items,
    primaryCtaUrl: `${BASE_URL}/docs`,
    primaryCtaLabel: "Explore docs & snapshots",
    decomposeDocsUrl: `${BASE_URL}/docs`,
    apiExampleCaption: "Decompose endpoint (HTTP)",
    apiExampleCode: `curl -s "${BASE_URL}/api/decompose?ticker=NVDA" \\
  -H "Authorization: Bearer $RISKMODELS_API_KEY"`,
  };
}

export type RunDigestJobResult = {
  scanned: number;
  skipped: number;
  wouldSend: string[];
  errors: string[];
};

/**
 * Dry-run job: lists eligible user ids; does not send mail (Phase 1 wires `sendEmail`).
 */
export async function runSnapshotDigestDryRun(): Promise<RunDigestJobResult> {
  const ids = await listDigestSubscriberUserIds();
  const wouldSend: string[] = [];
  let skipped = 0;

  for (const uid of ids) {
    const prefs = await loadUserEmailPreferences(uid);
    if (!prefs) {
      skipped++;
      continue;
    }
    const tickers = prefs.watch_tickers ?? [];
    const companies = prefs.fund_company_slugs ?? [];
    if (tickers.length === 0 && companies.length === 0) {
      skipped++;
      continue;
    }
    wouldSend.push(uid);
  }

  return {
    scanned: ids.length,
    skipped,
    wouldSend,
    errors: [],
  };
}
