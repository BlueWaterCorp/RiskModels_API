/**
 * "Key issued" email plus the setup-preference save that decides its copy.
 * Shared by POST /api/agent-keys (Generate) and POST /api/get-key/bootstrap
 * (first key issued on page load). Never throws: an email or preference
 * failure must not invalidate a key that already exists.
 */
import { sendEmail } from "@/lib/email-service";
import { formatExpiresAt, resolveRecipient } from "@/lib/agent/notify-expiring-api-keys";
import { API_TERMS_URL } from "@/emails/key-issued";
import { saveSetup } from "@/lib/email-engagement";
import {
  greetingName,
  parseAgentClient,
  parseWorkflow,
  setupExample,
} from "@/emails/engagement-content";

type Admin = { from: (table: string) => any };

export interface IssuedKeyRow {
  name?: string | null;
  key_prefix?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
}

export async function notifyKeyIssued(
  admin: Admin,
  userId: string,
  newKey: IssuedKeyRow,
  plainKey: string,
  input: { workflow?: unknown; agentClient?: unknown },
  logTag: string,
): Promise<void> {
  // Preference failures never invalidate an already-issued key. The next queue refresh enrolls it.
  let setup: Awaited<ReturnType<typeof saveSetup>> = null;
  try {
    setup = await saveSetup(userId, input.workflow, input.agentClient);
  } catch (e) {
    console.warn(`[${logTag}] setup preference save failed`, e instanceof Error ? e.message : "unknown");
  }
  const workflow = parseWorkflow(input.workflow) ?? parseWorkflow(setup?.workflow) ?? "exploring";
  const agentClient =
    workflow === "agent"
      ? (parseAgentClient(input.agentClient) ?? parseAgentClient(setup?.agent_client))
      : null;
  const isFirstKey =
    !!setup && !!newKey.created_at && Date.parse(setup.started_at) === Date.parse(newKey.created_at);
  const expiresAt = newKey.expires_at ?? null;
  if (!expiresAt) return;
  try {
    const recipient = await resolveRecipient(userId);
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    if (!recipient?.email) return;
    const createdAt = newKey.created_at ?? undefined;
    const sendResult = await sendEmail({
      to: recipient.email,
      subject: isFirstKey
        ? `RiskModels — ${setupExample(workflow, agentClient).title}`
        : "Your new RiskModels API key",
      template: "key-issued",
      data: {
        firstName: greetingName(profile?.full_name),
        workflow,
        agentClient,
        isFirstKey,
        keyName: newKey.name ?? "API key",
        keyPrefix: newKey.key_prefix ?? "rm_agent_",
        createdDateFormatted: createdAt
          ? formatExpiresAt(createdAt)
          : formatExpiresAt(new Date().toISOString()),
        expiresAtFormatted: formatExpiresAt(expiresAt),
        termsUrl: API_TERMS_URL,
        plaintextKey: plainKey,
      },
      userId,
    });
    if (!sendResult.success) {
      console.warn(`[${logTag}] key-issued email not sent:`, sendResult.error ?? "unknown");
    }
  } catch (e) {
    console.warn(`[${logTag}] key-issued email failed:`, e instanceof Error ? e.message : e);
  }
}
