/**
 * Confirm the contact email of an account created by POST /api/auth/provision.
 *
 * GET  ?token=…  shows a page with one button. It changes nothing, so a mail
 *                scanner that fetches the emailed link confirms nobody.
 * POST token=…   (the button, or JSON `{ "token": "…" }`) confirms.
 *
 * See lib/agent/provision-claim.ts for what confirming does and does not do.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimProvisionedAccount, previewClaim } from "@/lib/agent/provision-claim";

export const dynamic = "force-dynamic";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, bodyHtml: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${esc(title)} · RiskModels</title>
<style>
body{margin:0;background:#09090b;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:520px;margin:12vh auto;padding:0 20px}
h1{font-size:22px;margin:0 0 16px}
p{font-size:15px;line-height:1.6;color:#a1a1aa;margin:0 0 14px}
strong{color:#e4e4e7}
button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:11px 18px;font-size:15px;font-weight:600;cursor:pointer}
a{color:#60a5fa}
</style></head><body><main><h1>${esc(title)}</h1>${bodyHtml}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

const MESSAGES = {
  invalid: {
    title: "This link is not valid",
    body: "<p>The confirmation link is incomplete or was not issued by RiskModels. Nothing was changed.</p>",
    http: 404,
  },
  expired: {
    title: "This link has expired",
    body: "<p>Confirmation links work for 7 days. Nothing was changed. The API key keeps working on the free-tier limits; to use an account with a web sign-in, go to <a href=\"/get-key\">riskmodels.app/get-key</a>.</p>",
    http: 410,
  },
  already_verified: {
    title: "Already confirmed",
    body: "<p>This link has already been used. Nothing more to do.</p>",
    http: 200,
  },
} as const;

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const preview = await previewClaim(createAdminClient(), token);
  if (preview.status !== "pending") {
    const m = MESSAGES[preview.status];
    return page(m.title, m.body, m.http);
  }
  const name = esc(preview.agentName || "an API client");
  return page(
    "Confirm your email",
    `<p>A program calling the RiskModels API created an account named <strong>${name}</strong> and gave your address as its contact.</p>
<p>Confirm only if you run that program. The account then leaves the free-tier limits and carries the one-time $20 starter credit, and account notices are sent to you.</p>
<p>Confirming does not sign you in and does not change any account you already hold. If this was not you, close this page.</p>
<form method="post" action="/api/auth/provision/claim"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">Confirm this address</button></form>`,
  );
}

export async function POST(request: NextRequest) {
  const wantsJson = (request.headers.get("content-type") ?? "").includes("application/json");
  let token = "";
  try {
    if (wantsJson) {
      const body = (await request.json()) as { token?: unknown };
      token = typeof body?.token === "string" ? body.token : "";
    } else {
      const form = await request.formData();
      const v = form.get("token");
      token = typeof v === "string" ? v : "";
    }
  } catch {
    token = "";
  }

  let result;
  try {
    result = await claimProvisionedAccount(createAdminClient(), token);
  } catch (e) {
    console.error("[provision/claim]", e instanceof Error ? e.message : e);
    if (wantsJson) return NextResponse.json({ status: "error" }, { status: 500 });
    return page("Something went wrong", "<p>The address was not confirmed. Try the link again in a few minutes.</p>", 500);
  }

  if (wantsJson) {
    const http = result.status === "invalid" ? 404 : result.status === "expired" ? 410 : 200;
    return NextResponse.json({ status: result.status }, { status: http });
  }

  if (result.status === "verified") {
    return page(
      "Address confirmed",
      "<p>The account is off the free-tier limits and carries the one-time $20 starter credit. The API key the program already holds keeps working; no new key was issued.</p>",
    );
  }
  if (result.status === "verified_existing_address") {
    return page(
      "Address confirmed",
      "<p>This address already belongs to a RiskModels account, so the starter credit was not added a second time and the new account stays on the free-tier limits. To use your existing account and its credit, sign in at <a href=\"/get-key\">riskmodels.app/get-key</a> and create a key there.</p>",
    );
  }
  const m = MESSAGES[result.status];
  return page(m.title, m.body, m.http);
}
