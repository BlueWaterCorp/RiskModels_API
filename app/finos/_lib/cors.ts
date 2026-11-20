import type { NextRequest } from "next/server";

const DEFAULT_ORIGINS = ["http://localhost:3000"];

function allowedOrigins(): Set<string> {
  const configured = (process.env.FINOS_WORKSPACE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...configured]);
}

export function finosCors(req: NextRequest): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const origin = req.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }
  return headers;
}
