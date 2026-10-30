import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/lib/agent/capabilities";

type Capability = {
  id: string;
  description: string;
  parameters: Record<string, { required: boolean; enum?: string[]; description?: string }>;
};

const served = JSON.parse(
  readFileSync(join(process.cwd(), "mcp/data/capabilities.json"), "utf8"),
) as Capability[];

describe("fund-holdings capability", () => {
  it.each([
    ["source registry", CAPABILITIES as Capability[]],
    ["served catalog", served],
  ])("advertises dated selection and paired-parameter errors in the %s", (_label, capabilities) => {
    const capability = capabilities.find((entry) => entry.id === "fund-holdings");
    expect(capability).toBeDefined();
    expect(capability!.parameters.as_of.required).toBe(false);
    expect(capability!.parameters.time_basis.enum).toEqual(["report_date", "available_date"]);
    expect(capability!.parameters.time_basis.description).toContain("as_of_required");
    expect(capability!.description).toContain("404");
    expect(capability!.description).toContain("400");
  });
});
