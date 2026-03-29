import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

let _client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (_client) return _client;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const envName = (process.env.PLAID_ENV || "sandbox").toLowerCase();

  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID and PLAID_SECRET must be set for Plaid API routes");
  }

  const basePath =
    envName === "production"
      ? PlaidEnvironments.production
      : envName === "development"
        ? PlaidEnvironments.development
        : PlaidEnvironments.sandbox;

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  _client = new PlaidApi(configuration);
  return _client;
}
