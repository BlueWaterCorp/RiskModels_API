import {
  Body,
  Button,
  CodeBlock,
  Container,
  dracula,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BASE_URL, LOGO_URL, SUPPORT_EMAIL } from "./constants";

/** Canonical API Terms (matches README / API_TERMS.md). */
export const API_TERMS_URL = "https://riskmodels.net/terms/api";

export interface KeyIssuedEmailProps {
  /** Display name / first name (from profile or email local-part). */
  firstName: string;
  keyName: string;
  keyPrefix: string;
  createdDateFormatted: string;
  expiresAtFormatted: string;
  termsUrl: string;
}

const MCP_CURSOR_JSON = `{
  "mcpServers": {
    "riskmodels": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://riskmodels.app/api/mcp/sse"],
      "env": { "AUTHORIZATION": "Bearer PASTE_YOUR_KEY_HERE" }
    }
  }
}`;

const CLAUDE_CODE_BASH = `claude mcp add riskmodels npx -y mcp-remote https://riskmodels.app/api/mcp/sse`;

const CLAUDE_CODE_EXPORT = `export AUTHORIZATION="Bearer rm_agent_live_..."`;

const PYTHON_PIP = `pip install "riskmodels-py[viz]"`;

const PYTHON_SNIPPET = `from riskmodels import RiskModelsClient
client = RiskModelsClient(api_key="rm_agent_live_...")   # or set RISKMODELS_API_KEY env var
client.get_metrics("NVDA")`;

const PYTHON_ONELINERS = `client.get_l3_decomposition("NVDA")           # time series — returns DataFrame
client.get_ticker_returns("NVDA")             # daily returns + hedge ratios
client.get_macro_factor_series("NVDA")        # NVDA vs VIX/inflation/oil/…
client.analyze_portfolio([                    # portfolio risk in one call
    {"ticker": "NVDA", "weight": 0.4},
    {"ticker": "AAPL", "weight": 0.3},
    {"ticker": "XOM",  "weight": 0.3},
])`;

const COLAB_SNIPPET = `from google.colab import userdata
import os
os.environ["RISKMODELS_API_KEY"] = userdata.get("RISKMODELS_API_KEY")

!pip install -q "riskmodels-py[viz]"

from riskmodels import RiskModelsClient
client = RiskModelsClient.from_env()     # reads RISKMODELS_API_KEY
client.get_metrics("NVDA")`;

const DOTENV_SNIPPET = `from dotenv import load_dotenv       # pip install python-dotenv
load_dotenv()
from riskmodels import RiskModelsClient
client = RiskModelsClient.from_env()`;

const CLI_SNIPPET = `npm install -g riskmodels-cli
export RISKMODELS_API_KEY="rm_agent_live_..."
riskmodels metrics NVDA`;

export const KeyIssuedEmail = ({
  firstName = "there",
  keyName = "API Key 1",
  keyPrefix = "rm_agent_live_",
  createdDateFormatted = "April 17, 2026",
  expiresAtFormatted = "April 17, 2027",
  termsUrl = API_TERMS_URL,
}: KeyIssuedEmailProps) => {
  const getKeyUrl = `${BASE_URL}/get-key`;
  const usageUrl = `${BASE_URL}/account/usage`;
  const apiDocsUrl = `${BASE_URL}/api-docs`;
  const quickstartUrl = `${BASE_URL}/quickstart`;
  const pythonSdkUrl = `${BASE_URL}/docs/python-sdk`;
  const schemasUrl = `${BASE_URL}/schemas`;
  const statusUrl = `${BASE_URL}/status`;
  const authDocsUrl = `${BASE_URL}/docs/authentication`;

  return (
    <Html>
      <Head />
      <Preview>
        {`RiskModels.app — 5-minute setup (MCP, SDK, or CLI). Key "${keyName}" · expires ${expiresAtFormatted}`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Img src={LOGO_URL} width="48" height="48" alt="RiskModels" style={logo} />
          <Heading style={heading}>
            RiskModels.app — 5-minute setup (whether you use Cursor/Claude or just Python)
          </Heading>

          <Text style={paragraph}>
            Hi <strong>{firstName}</strong>,
          </Text>

          <Text style={paragraph}>
            Welcome to <strong>RiskModels.app</strong>. You now have three ways to ask us for risk
            data. You don&apos;t need all of them — <strong>pick the one that matches your workflow</strong>{" "}
            and ignore the others. Here&apos;s the 30-second primer:
          </Text>

          <Section style={tableWrap}>
            <table style={dataTable} cellPadding={0} cellSpacing={0}>
              <thead>
                <tr>
                  <th style={th}>You see it called…</th>
                  <th style={th}>In plain words</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={td}>
                    <strong>MCP</strong>
                  </td>
                  <td style={td}>
                    &quot;Give Cursor / Claude / Codex / Windsurf a new superpower.&quot; You add one JSON
                    block to your coding agent&apos;s config, and now it can call RiskModels as naturally
                    as it reads files. No code to write — you just ask the agent questions.
                  </td>
                </tr>
                <tr>
                  <td style={td}>
                    <strong>SDK</strong>
                  </td>
                  <td style={td}>
                    A <strong>Python library</strong>.{" "}
                    <code style={inlineCode}>pip install riskmodels-py</code>, then{" "}
                    <code style={inlineCode}>client.get_metrics(&quot;NVDA&quot;)</code> in a notebook.
                    Best for Jupyter, Colab, research scripts, anywhere you want a DataFrame back.
                  </td>
                </tr>
                <tr>
                  <td style={td}>
                    <strong>CLI</strong>
                  </td>
                  <td style={td}>
                    A <strong>terminal command</strong>.{" "}
                    <code style={inlineCode}>riskmodels metrics NVDA</code> prints JSON. Nice for quick
                    checks, shell scripts, and demos; not needed if you&apos;re happy in Python.
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Text style={paragraph}>
            <strong>All three hit the same data.</strong> Most people use one and add others later.
            Fastest path to a working call:
          </Text>
          <Text style={paragraph}>
            • <strong>If you use a coding agent</strong> (Cursor, Claude Code, Claude Desktop, Codex,
            Windsurf, Zed) → jump to <em>Path A</em> below.
            <br />
            • <strong>If you just want data in Python/Colab/terminal</strong> → jump to <em>Path B</em>.
          </Text>

          <Heading as="h2" style={h2}>
            Step 0 — Your API key (you just created one)
          </Heading>
          <Text style={paragraph}>
            You created <strong>{keyName}</strong> on{" "}
            <Link href={getKeyUrl} style={link}>
              {getKeyUrl.replace(/^https?:\/\//, "")}
            </Link>
            . The full key was shown <strong>once</strong> — copy it now if that screen is still open.
            You can rename keys later with the pencil icon on the key list.
          </Text>
          <Text style={paragraph}>
            The key looks like <code style={inlineCode}>{keyPrefix}…</code>. Treat it like a password:
            don&apos;t paste into chats, don&apos;t commit to GitHub. Store{" "}
            <code style={inlineCode}>RISKMODELS_API_KEY</code> in a secret manager,{" "}
            <code style={inlineCode}>.env</code> (gitignored), or your agent config — see Path A/B below.
          </Text>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>
            Path A — &quot;I use an AI coding agent&quot;
          </Heading>
          <Text style={paragraph}>
            Your agent gets <strong>6 new tools</strong> it can call: latest risk metrics, L3 hierarchical
            decomposition, portfolio risk snapshot, and three discovery tools. Ask in English; it picks the
            tool.
          </Text>

          <Text style={h3}>Cursor</Text>
          <Text style={paragraph}>
            Create or open <code style={inlineCode}>.cursor/mcp.json</code> in your project (or{" "}
            <code style={inlineCode}>~/.cursor/mcp.json</code> for a global install) and paste:
          </Text>
          <CodeBlock theme={dracula} language="json" code={MCP_CURSOR_JSON} />
          <Text style={paragraph}>
            Restart Cursor. Open a chat → the tools icon should list &quot;riskmodels&quot; with 6 tools.
            Test with: <em>What&apos;s NVDA&apos;s L3 subsector hedge ratio today?</em>
          </Text>

          <Text style={h3}>Claude Desktop</Text>
          <Text style={paragraph}>
            Edit <code style={inlineCode}>~/Library/Application Support/Claude/claude_desktop_config.json</code>{" "}
            (Windows: <code style={inlineCode}>%APPDATA%\Claude\claude_desktop_config.json</code>). Same JSON
            block as above. Quit and reopen Claude Desktop (the app caches MCP config — just closing the window
            isn&apos;t enough).
          </Text>

          <Text style={h3}>Claude Code (CLI)</Text>
          <Text style={paragraph}>In the project you&apos;re working in, run:</Text>
          <CodeBlock theme={dracula} language="bash" code={CLAUDE_CODE_BASH} />
          <Text style={paragraph}>Then set the key:</Text>
          <CodeBlock theme={dracula} language="bash" code={CLAUDE_CODE_EXPORT} />
          <Text style={paragraph}>Next <code style={inlineCode}>claude</code> session can call the tools.</Text>

          <Text style={h3}>Codex / Windsurf / Zed</Text>
          <Text style={paragraph}>
            Same <code style={inlineCode}>mcp-remote</code> pattern — check your agent&apos;s MCP docs for the
            config file location; the JSON block is identical to Cursor&apos;s.
          </Text>

          <Text style={h3}>Troubleshooting Path A</Text>
          <Section style={tableWrap}>
            <table style={dataTable} cellPadding={0} cellSpacing={0}>
              <thead>
                <tr>
                  <th style={th}>Symptom</th>
                  <th style={th}>Fix</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={td}>&quot;Tools don&apos;t appear&quot;</td>
                  <td style={td}>
                    Fully quit and relaunch the agent. Then check Developer Tools / logs for{" "}
                    <code style={inlineCode}>mcp-remote</code> errors.
                  </td>
                </tr>
                <tr>
                  <td style={td}>&quot;401 Unauthorized&quot;</td>
                  <td style={td}>
                    Your <code style={inlineCode}>AUTHORIZATION</code> env is missing the{" "}
                    <code style={inlineCode}>Bearer </code> prefix. It should be{" "}
                    <code style={inlineCode}>Bearer rm_agent_live_…</code>.
                  </td>
                </tr>
                <tr>
                  <td style={td}>&quot;Can&apos;t find npx&quot;</td>
                  <td style={td}>
                    Install Node.js from <Link href="https://nodejs.org">nodejs.org</Link> (any LTS).{" "}
                    <code style={inlineCode}>npx</code> comes with it.
                  </td>
                </tr>
                <tr>
                  <td style={td}>&quot;Works for me but not my teammate&quot;</td>
                  <td style={td}>
                    The config JSON is per-machine. Share the snippet; each teammate pastes their own key.
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>
            Path B — &quot;I just want data in Python (or my terminal)&quot;
          </Heading>

          <Text style={h3}>B1. Python — 3 lines in a notebook</Text>
          <CodeBlock theme={dracula} language="bash" code={PYTHON_PIP} />
          <Text style={paragraph}>
            (<code style={inlineCode}>[viz]</code> pulls in Plotly / Matplotlib for built-in charts. Drop{" "}
            <code style={inlineCode}>[viz]</code> if you just want the data.)
          </Text>
          <CodeBlock theme={dracula} language="python" code={PYTHON_SNIPPET} />
          <Text style={paragraph}>
            You should get back a dict with NVDA&apos;s latest <code style={inlineCode}>teo</code>, hedge
            ratios (<code style={inlineCode}>l1_market_beta</code>, <code style={inlineCode}>l2_sector_beta</code>
            , <code style={inlineCode}>l3_subsector_beta</code>), and combined-factor returns (
            <code style={inlineCode}>l1/l2/l3_combined_factor_return</code>). Cost: ~$0.001 for that call,
            deducted from your $20 credit.
          </Text>
          <Text style={paragraph}>A handful more one-liners once that works:</Text>
          <CodeBlock theme={dracula} language="python" code={PYTHON_ONELINERS} />

          <Text style={h3}>B2. Google Colab — saving the key safely</Text>
          <Text style={paragraph}>
            <strong>Don&apos;t paste the key into a cell.</strong> Colab will save it to your notebook history.
            Use Colab&apos;s secrets manager (key icon → Add new secret → name{" "}
            <code style={inlineCode}>RISKMODELS_API_KEY</code> → toggle Notebook access). Then:
          </Text>
          <CodeBlock theme={dracula} language="python" code={COLAB_SNIPPET} />

          <Text style={h3}>B3. Jupyter / VS Code / local Python — saving the key safely</Text>
          <Text style={paragraph}>
            Put the key in a local <code style={inlineCode}>.env</code> file and load it at runtime:
          </Text>
          <CodeBlock
            theme={dracula}
            language="bash"
            code={`# Run once, in the project directory
echo 'RISKMODELS_API_KEY=rm_agent_live_...' >> .env
echo '.env' >> .gitignore         # never commit it`}
          />
          <CodeBlock theme={dracula} language="python" code={DOTENV_SNIPPET} />
          <Text style={paragraph}>
            Or set it once in your shell profile (<code style={inlineCode}>~/.zshrc</code>,{" "}
            <code style={inlineCode}>~/.bashrc</code>):
          </Text>
          <CodeBlock
            theme={dracula}
            language="bash"
            code={`export RISKMODELS_API_KEY="rm_agent_live_..."`}
          />

          <Text style={h3}>B4. Terminal-only (CLI) — optional</Text>
          <CodeBlock theme={dracula} language="bash" code={CLI_SNIPPET} />
          <Text style={paragraph}>
            Other commands: <code style={inlineCode}>riskmodels l3 NVDA</code>,{" "}
            <code style={inlineCode}>riskmodels returns NVDA</code>,{" "}
            <code style={inlineCode}>riskmodels macro NVDA</code>,{" "}
            <code style={inlineCode}>riskmodels batch NVDA AAPL XOM</code>,{" "}
            <code style={inlineCode}>riskmodels balance</code>, <code style={inlineCode}>riskmodels --help</code>
            .
          </Text>

          <Text style={h3}>Troubleshooting Path B</Text>
          <Section style={tableWrap}>
            <table style={dataTable} cellPadding={0} cellSpacing={0}>
              <thead>
                <tr>
                  <th style={th}>Symptom</th>
                  <th style={th}>Fix</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={td}>
                    <code style={inlineCode}>401 Unauthorized</code>
                  </td>
                  <td style={td}>
                    <code style={inlineCode}>echo $RISKMODELS_API_KEY</code> — is it set? If yes, regenerate at{" "}
                    {getKeyUrl.replace(/^https?:\/\//, "")} (keys can be rotated).
                  </td>
                </tr>
                <tr>
                  <td style={td}>
                    <code style={inlineCode}>402 Payment Required</code>
                  </td>
                  <td style={td}>
                    Balance hit zero. Top up under Account → Billing or raise your daily cap.
                  </td>
                </tr>
                <tr>
                  <td style={td}>
                    <code style={inlineCode}>429 Rate Limited</code>
                  </td>
                  <td style={td}>
                    Default is 60 requests/minute per key. Reply to this email to request higher.
                  </td>
                </tr>
                <tr>
                  <td style={td}>Colab can&apos;t find <code style={inlineCode}>userdata</code></td>
                  <td style={td}>
                    The key icon / <code style={inlineCode}>userdata</code> API is Colab-only. In Jupyter, use
                    the <code style={inlineCode}>.env</code> approach in B3.
                  </td>
                </tr>
                <tr>
                  <td style={td}>
                    <code style={inlineCode}>riskmodels-py</code> imports but <code style={inlineCode}>client.get_metrics</code> returns{" "}
                    <code style={inlineCode}>None</code>
                  </td>
                  <td style={td}>
                    Some micro-caps and recent IPOs aren&apos;t in our universe (top ~3000 US equities). Try a
                    mainstream ticker first; if it&apos;s still empty, reply with the ticker and we&apos;ll
                    check.
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>
            When you want to go deeper
          </Heading>
          <Text style={paragraph}>
            • <strong>Full method list:</strong>{" "}
            <Link href={apiDocsUrl} style={link}>
              {apiDocsUrl.replace(/^https?:\/\//, "")}
            </Link>
            <br />
            • <strong>Interactive quickstart notebook:</strong>{" "}
            <Link href={quickstartUrl} style={link}>
              {quickstartUrl.replace(/^https?:\/\//, "")}
            </Link>
            <br />
            • <strong>Python SDK reference:</strong>{" "}
            <Link href={pythonSdkUrl} style={link}>
              {pythonSdkUrl.replace(/^https?:\/\//, "")}
            </Link>
            <br />
            • <strong>Response schemas (every field typed):</strong>{" "}
            <Link href={schemasUrl} style={link}>
              {schemasUrl.replace(/^https?:\/\//, "")}
            </Link>
          </Text>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>
            Your account at a glance
          </Heading>
          <Section style={tableWrap}>
            <table style={dataTable} cellPadding={0} cellSpacing={0}>
              <tbody>
                <tr>
                  <td style={tdNarrow}>
                    <strong>Key name</strong>
                  </td>
                  <td style={td}>
                    <strong>{keyName}</strong> — rename anytime with the pencil icon on{" "}
                    <Link href={getKeyUrl} style={link}>
                      {getKeyUrl.replace(/^https?:\/\//, "")}
                    </Link>
                  </td>
                </tr>
                <tr>
                  <td style={tdNarrow}>
                    <strong>Key prefix</strong>
                  </td>
                  <td style={td}>
                    <code style={inlineCode}>{keyPrefix}…</code> — the visible first 15 chars. The full secret
                    is shown once at creation; we only store a hash server-side.
                  </td>
                </tr>
                <tr>
                  <td style={tdNarrow}>
                    <strong>Issued</strong>
                  </td>
                  <td style={td}>{createdDateFormatted}</td>
                </tr>
                <tr>
                  <td style={tdNarrow}>
                    <strong>Expires</strong>
                  </td>
                  <td style={td}>
                    {expiresAtFormatted} (1 year from issue — we&apos;ll email you at{" "}
                    <strong>14, 7, and 1 day</strong> before)
                  </td>
                </tr>
                <tr>
                  <td style={tdNarrow}>
                    <strong>Starting balance</strong>
                  </td>
                  <td style={td}>
                    <strong>$20.00</strong> in free credits
                  </td>
                </tr>
                <tr>
                  <td style={tdNarrow}>
                    <strong>Rate limit</strong>
                  </td>
                  <td style={td}>
                    <strong>60 requests / minute / key</strong> (reply if you need higher)
                  </td>
                </tr>
                <tr>
                  <td style={tdNarrow}>
                    <strong>Daily spend cap</strong>
                  </td>
                  <td style={td}>
                    None by default — set your own at{" "}
                    <Link href={usageUrl} style={link}>
                      {usageUrl.replace(/^https?:\/\//, "")}
                    </Link>{" "}
                    → Daily cap
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Heading as="h2" style={h2}>
            Key terms — the 30-second version
          </Heading>
          <Text style={paragraph}>
            • <strong>Your key is yours.</strong> Don&apos;t share it and don&apos;t commit it to GitHub. If it
            leaks, <strong>revoke</strong> in{" "}
            <Link href={getKeyUrl} style={link}>
              /get-key
            </Link>{" "}
            and create a new one — the old key returns <code style={inlineCode}>401</code> immediately.
            <br />
            <br />
            • <strong>Data freshness.</strong> US equities, daily EOD, posted shortly after market close (~17:30
            ET). History back to 2006.
            <br />
            <br />
            • <strong>Billing.</strong> Per-request, from $0.001 per call. Every response carries an{" "}
            <code style={inlineCode}>_cost_usd</code> field. Low-balance emails at $1.
            <br />
            <br />
            • <strong>Expiry.</strong> Each key is valid <strong>1 year</strong> from issue. Reminder emails go
            out 14 / 7 / 1 day before. Expired keys return <code style={inlineCode}>401</code> until you create a
            fresh one (1-click in the dashboard).
            <br />
            <br />
            • <strong>Fair use.</strong> Build whatever you like — trading systems, research notebooks, public
            demos, commercial products. The one rule: <strong>don&apos;t redistribute the raw data feed</strong>{" "}
            to third parties. If that&apos;s what you need, reply and we&apos;ll set up a redistribution
            license.
            <br />
            <br />
            • <strong>What we log.</strong> Timestamp, endpoint, cost, and key prefix for billing +
            rate-limiting. We do <strong>not</strong> log request bodies, tickers, or portfolio contents beyond
            aggregate counts.
            <br />
            <br />• <strong>Full terms of service:</strong>{" "}
            <Link href={termsUrl} style={link}>
              riskmodels.net/terms/api
            </Link>
          </Text>

          <Heading as="h2" style={h2}>
            Support
          </Heading>
          <Text style={paragraph}>
            • Questions, bugs, feature requests → reply to this email or write to{" "}
            <Link href={`mailto:${SUPPORT_EMAIL}`} style={link}>
              {SUPPORT_EMAIL}
            </Link>
            <br />
            • Account + usage dashboard →{" "}
            <Link href={usageUrl} style={link}>
              {usageUrl.replace(/^https?:\/\//, "")}
            </Link>
            <br />• Status &amp; known issues →{" "}
            <Link href={statusUrl} style={link}>
              {statusUrl.replace(/^https?:\/\//, "")}
            </Link>
          </Text>

          <Text style={paragraph}>
            Reply with the workflow you&apos;re building and we&apos;ll point you at the right example. We ship
            updates weekly — if something&apos;s missing, say so.
          </Text>

          <Text style={paragraph}>
            Cheers,
            <br />
            <strong>The RiskModels team</strong>
            <br />
            <Link href={`mailto:${SUPPORT_EMAIL}`} style={link}>
              {SUPPORT_EMAIL}
            </Link>{" "}
            · <Link href={BASE_URL} style={link}>{BASE_URL.replace(/^https?:\/\//, "")}</Link>
          </Text>

          <Section style={buttonContainer}>
            <Button style={button} href={getKeyUrl}>
              Open API keys
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={small}>
            Authentication guide:{" "}
            <Link href={authDocsUrl} style={link}>
              {authDocsUrl.replace(/^https?:\/\//, "")}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default KeyIssuedEmail;

const main = {
  backgroundColor: "#09090b",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "32px 24px 48px",
  maxWidth: "600px",
};

const logo = { margin: "0 auto 16px", display: "block" as const };

const heading = {
  color: "#fafafa",
  fontSize: "20px",
  fontWeight: "600",
  lineHeight: "1.35",
  margin: "0 0 20px",
};

const h2 = {
  color: "#e4e4e7",
  fontSize: "17px",
  fontWeight: "600",
  lineHeight: "1.35",
  margin: "28px 0 12px",
};

const h3 = {
  color: "#d4d4d8",
  fontSize: "15px",
  fontWeight: "600",
  margin: "20px 0 8px",
};

const paragraph = {
  color: "#a1a1aa",
  fontSize: "14px",
  lineHeight: "1.65",
  margin: "0 0 14px",
};

const tableWrap = { margin: "0 0 16px" };

const dataTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
  border: "1px solid #3f3f46",
  borderRadius: "8px",
  overflow: "hidden" as const,
};

const th = {
  textAlign: "left" as const,
  padding: "10px 12px",
  backgroundColor: "#18181b",
  color: "#fafafa",
  fontSize: "13px",
  fontWeight: "600",
  borderBottom: "1px solid #3f3f46",
};

const td = {
  verticalAlign: "top" as const,
  padding: "10px 12px",
  color: "#a1a1aa",
  fontSize: "13px",
  lineHeight: "1.55",
  borderBottom: "1px solid #27272a",
};

const tdNarrow = {
  ...td,
  width: "32%",
  color: "#d4d4d8",
  fontWeight: "500",
};

const hr = { borderColor: "#27272a", margin: "28px 0" };

const buttonContainer = { textAlign: "center" as const, margin: "24px 0" };

const button = {
  backgroundColor: "#2563eb",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "15px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const small = { color: "#71717a", fontSize: "12px", lineHeight: "1.5", margin: "0" };

const link = { color: "#60a5fa", textDecoration: "underline" };

const inlineCode = {
  backgroundColor: "#27272a",
  padding: "2px 6px",
  borderRadius: "4px",
  fontSize: "12px",
  color: "#e4e4e7",
};
