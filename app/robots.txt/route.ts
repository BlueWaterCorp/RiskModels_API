import { getAppUrl } from '@/lib/app-url';

/**
 * Plain robots.txt with a comment pointing agents at /llms.txt (llmstxt.org-style bootstrap).
 */
export async function GET() {
  const base = getAppUrl();
  const body = `# https://www.robotstxt.org/robotstxt.html
User-agent: *
Allow: /

# Machine-readable agent bootstrap (MCP install, curl, optional public MAG7 demo Bearer when enabled):
# ${base}/llms.txt
`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
