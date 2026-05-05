import { buildLlmsTxt } from "@/lib/llms-txt";

export const dynamic = "force-dynamic";

export async function GET() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://riskmodels.app";
  const body = buildLlmsTxt(appUrl);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
