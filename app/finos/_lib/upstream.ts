function riskModelsApiBase(): string {
  return (
    process.env.NEXT_PUBLIC_RISKMODELS_API_URL || "https://riskmodels.app/api"
  ).replace(/\/+$/, "");
}

export function bearerFromFinosRequest(req: Request): string | null {
  const value = req.headers.get("authorization")?.trim() || "";
  if (!value) return null;
  return value.toLowerCase().startsWith("bearer ")
    ? value.slice(7).trim()
    : value;
}

export async function getRiskModelsJson(
  path: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const url = `${riskModelsApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = { error: "RiskModels returned a non-JSON response" };
  }
  return { status: response.status, body };
}
