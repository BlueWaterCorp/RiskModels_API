/**
 * OpenAI Apps domain verification for the RiskModels MCP app submission.
 * Must return exactly the challenge token as plain text: no JSON, HTML,
 * quotes, trailing newline or authentication.
 */
const OPENAI_APPS_CHALLENGE = "WR15nAff2SaJZ_botD-M6U4-8qyuxv4j1iw5kGLA9qU";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(OPENAI_APPS_CHALLENGE, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
