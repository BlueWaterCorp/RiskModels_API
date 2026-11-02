/**
 * Invite someone to the security master feed by hand.
 *
 *   npx tsx scripts/feed-invite.ts --email a@example.com --name "A. Analyst" \
 *     --invited-by "Conrad Gann" [--role "founder of RiskModels"] [--note "..."] [--dry-run]
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY
 * in the environment (run it under the secrets manager). Prints one line:
 * the outcome (sent, already_on_list, already_invited, in_progress,
 * unsubscribed, invalid_email or dry_run). On failure it prints a fixed event
 * name or a safe error code, never an upstream message, the address, an
 * unsubscribe token or any key.
 */

import { FeedInviteError, inviteToFeedWaitlist } from "../lib/feed-invite";
import { safeErrorCode } from "../lib/safe-log";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const inviterName = arg("invited-by");
  if (!email || !inviterName) {
    console.error('usage: feed-invite --email <address> --invited-by "<Name>" [--name] [--role] [--note] [--dry-run]');
    process.exit(2);
  }
  const outcome = await inviteToFeedWaitlist({
    email,
    name: arg("name") ?? null,
    inviterName,
    inviterRole: arg("role") ?? "founder of RiskModels",
    note: arg("note") ?? null,
    dryRun: process.argv.includes("--dry-run"),
  });
  console.log(`${outcome}`);
}

main().catch((err) => {
  // A fixed event name or a safe code only: upstream messages can quote the address or a token.
  console.error("feed-invite failed:", err instanceof FeedInviteError ? err.event : safeErrorCode(err));
  process.exit(1);
});
