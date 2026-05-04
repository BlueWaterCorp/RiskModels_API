import type { RiskModelsClient } from "./client.js";
import type { RiskModelsResult, WhitepaperExampleId, WhitepaperExampleResult } from "./types.js";

interface WhitepaperExampleDefinition {
  id: WhitepaperExampleId;
  chapterUri: string;
  chapterTitle: string;
  chapterText: string;
  promptToTry: string;
}

const EXAMPLES: Record<WhitepaperExampleId, WhitepaperExampleDefinition> = {
  "aapl-vs-nvda": {
    id: "aapl-vs-nvda",
    chapterUri: "riskmodels://whitepaper/chapter/02-aapl-vs-nvda",
    chapterTitle: "AAPL vs NVDA: Same Label, Different Bet",
    chapterText:
      "Two stocks can share a technology label while carrying very different market, sector, subsector, and residual risk profiles.",
    promptToTry: "Compare AAPL and NVDA using RiskModels. What am I really betting on?",
  },
  "aapl-nvda-crwd": {
    id: "aapl-nvda-crwd",
    chapterUri: "riskmodels://examples/aapl-nvda-crwd",
    chapterTitle: "Three Technology Positions, Three Risk Shapes",
    chapterText:
      "A live comparison across AAPL, NVDA, and CRWD shows how the four-bet lens separates broad market exposure from sector, subsector, and stock-specific risk.",
    promptToTry: "Decompose AAPL, NVDA, and CRWD and show the chart data.",
  },
  "nvda-10000-hedge": {
    id: "nvda-10000-hedge",
    chapterUri: "riskmodels://whitepaper/chapter/03-hedging",
    chapterTitle: "Turning A Position Into ETF Hedge Legs",
    chapterText:
      "Hedge ratios are dollars of ETF per dollar of stock. Scaling them to a position size turns abstract exposures into tradable ETF notionals.",
    promptToTry: "How would RiskModels hedge a $10,000 NVDA position?",
  },
  "portfolio-decomposition": {
    id: "portfolio-decomposition",
    chapterUri: "riskmodels://whitepaper/one-position-four-bets",
    chapterTitle: "From One Position To A Portfolio",
    chapterText:
      "The same market, sector, subsector, and residual decomposition can be rolled up from single names into a portfolio-level risk view.",
    promptToTry: "Explain my portfolio using RiskModels and show the decomposition chart.",
  },
};

function attachWhitepaperFields<TRaw>(
  result: RiskModelsResult<TRaw>,
  definition: WhitepaperExampleDefinition,
): WhitepaperExampleResult<TRaw> {
  return {
    ...result,
    example_id: definition.id,
    chapter_uri: definition.chapterUri,
    chapter_title: definition.chapterTitle,
    chapter_text: definition.chapterText,
    prompt_to_try: definition.promptToTry,
  };
}

export function listWhitepaperExamples(): WhitepaperExampleDefinition[] {
  return Object.values(EXAMPLES);
}

export async function runWhitepaperExample(
  client: Pick<RiskModelsClient, "compare" | "hedgePosition" | "portfolioDecompose">,
  exampleId: WhitepaperExampleId,
): Promise<WhitepaperExampleResult> {
  const definition = EXAMPLES[exampleId];
  if (!definition) {
    throw new Error(`Unknown whitepaper example: ${exampleId}`);
  }

  if (exampleId === "aapl-vs-nvda") {
    return attachWhitepaperFields(await client.compare(["AAPL", "NVDA"]), definition);
  }
  if (exampleId === "aapl-nvda-crwd") {
    return attachWhitepaperFields(await client.compare(["AAPL", "NVDA", "CRWD"]), definition);
  }
  if (exampleId === "nvda-10000-hedge") {
    return attachWhitepaperFields(
      await client.hedgePosition({ ticker: "NVDA", dollars: 10_000 }),
      definition,
    );
  }
  return attachWhitepaperFields(
    await client.portfolioDecompose([
      { ticker: "AAPL", weight: 0.4 },
      { ticker: "NVDA", weight: 0.35 },
      { ticker: "CRWD", weight: 0.25 },
    ]),
    definition,
  );
}
