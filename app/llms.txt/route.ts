import { buildLlmsTxt } from "@/lib/llms-txt";
import { getCoverageFacts } from "@/lib/dal/coverage-facts";

export const dynamic = "force-dynamic";

export async function GET() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://riskmodels.app";
  const facts = await getCoverageFacts().catch(() => null);
  const body = buildLlmsTxt(appUrl, facts);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
