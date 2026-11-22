/**
 * Machine-readable hint returned in `_agent` on 401 responses when the request
 * carried no credentials. One definition so every route describes agent
 * self-provisioning the same way, and the way it actually behaves.
 */
export const PROVISION_AUTH_HINT = {
  action: "authenticate",
  authenticate_url: "/api/auth/provision",
  method: "POST",
  content_type: "application/json",
  body: {
    agent_name: "string, required",
    agent_id: "string, required, unique, 3-100 chars [A-Za-z0-9._:-]",
    contact_email: "string, required; unverified until its owner confirms from an emailed link",
  },
  returns: "credentials.api_key in the 201 response (shown once). No browser, payment or captcha.",
  limits_until_contact_verified: "free tier: 100 requests/day, 10/minute",
  after_contact_verified: "60 requests/minute, no daily cap, one-time $20 starter credit",
  rate_limit: "3 accounts per IP per 24h, shared with /api/auth/provision-free",
  no_email_alternative: "/api/auth/provision-free",
  human_signup_url: "https://riskmodels.app/get-key",
} as const;
