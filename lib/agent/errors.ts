/**
 * Agent API Error Handling
 *
 * Standardized error responses for agent-facing APIs.
 * Includes HTTP 402 Payment Required support.
 */

import { NextResponse } from "next/server";

export interface PaymentRequiredError {
  error: "Payment Required";
  error_code:
    | "INSUFFICIENT_BALANCE"
    | "PAYMENT_METHOD_REQUIRED"
    | "ACCOUNT_SUSPENDED";
  message: string;
  required_amount_usd: number;
  current_balance_usd: number;
  shortfall_usd: number;
  top_up_url: string;
  minimum_top_up_usd: number;
  _agent: {
    action: "top_up" | "add_payment_method" | "contact_support";
    top_up_url: string;
    min_top_up_usd: number;
    retry_after_seconds?: number;
  };
}

export interface MonthlyCapExceededError {
  error: "Too Many Requests";
  error_code: "MONTHLY_SPEND_CAP_EXCEEDED";
  message: string;
  monthly_spend_cap_usd: number;
  current_monthly_spend_usd: number;
  projected_spend_usd: number;
  reset_at: string;
  days_until_reset: number;
  _agent: {
    action: "adjust_cap" | "contact_support";
    adjust_cap_url: string;
    retry_after_seconds: number;
  };
}

/**
 * Create HTTP 402 Payment Required response
 *
 * Per the article: "HTTP has had a status code for this since 1997: 402 Payment Required.
 * It was 'reserved for future use' for almost three decades. We're finally finding that use."
 */
export function createPaymentRequiredResponse(
  requiredAmount: number,
  currentBalance: number,
  appUrl: string = process.env.NEXT_PUBLIC_APP_URL || "https://riskmodels.net",
): NextResponse {
  const shortfall = Math.max(0, requiredAmount - currentBalance);
  const minTopUp = Math.max(10, Math.ceil(shortfall / 10) * 10); // Round up to nearest $10, minimum $10

  const body: PaymentRequiredError = {
    error: "Payment Required",
    error_code: "INSUFFICIENT_BALANCE",
    message: `This request costs $${requiredAmount.toFixed(3)} but your balance is $${currentBalance.toFixed(2)}. Please top up to continue.`,
    required_amount_usd: requiredAmount,
    current_balance_usd: currentBalance,
    shortfall_usd: shortfall,
    top_up_url: `${appUrl}/api/billing/top-up`,
    minimum_top_up_usd: minTopUp,
    _agent: {
      action: "top_up",
      top_up_url: `${appUrl}/api/billing/top-up`,
      min_top_up_usd: minTopUp,
      retry_after_seconds: 60,
    },
  };

  return NextResponse.json(body, {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-API-Cost-USD": String(requiredAmount),
      "X-Current-Balance-USD": String(currentBalance),
      "X-Shortfall-USD": String(shortfall),
      "X-Top-Up-URL": `${appUrl}/api/billing/top-up`,
      "Retry-After": "60",
    },
  });
}

/**
 * Create HTTP 429 Too Many Requests response for monthly spend cap exceeded
 *
 * Returns 429 (not 402) because this is a rate limit / quota issue, not a payment issue.
 * The user has funds, they've just hit their self-imposed safety limit.
 */
export function createMonthlyCapExceededResponse(
  currentSpend: number,
  cap: number,
  resetAt: Date,
  appUrl: string = process.env.NEXT_PUBLIC_APP_URL || "https://riskmodels.net",
): NextResponse {
  const now = new Date();
  const resetDate = new Date(resetAt);
  
  // Set reset to next month if we're past the current reset date
  if (resetDate <= now) {
    resetDate.setMonth(resetDate.getMonth() + 1);
    resetDate.setDate(1);
    resetDate.setHours(0, 0, 0, 0);
  }
  
  const msUntilReset = resetDate.getTime() - now.getTime();
  const daysUntilReset = Math.ceil(msUntilReset / (1000 * 60 * 60 * 24));
  const retryAfterSeconds = Math.ceil(msUntilReset / 1000);

  const body: MonthlyCapExceededError = {
    error: "Too Many Requests",
    error_code: "MONTHLY_SPEND_CAP_EXCEEDED",
    message: `Monthly spend cap of $${cap.toFixed(2)} exceeded. Current spend: $${currentSpend.toFixed(2)}. Your cap will reset in ${daysUntilReset} days.`,
    monthly_spend_cap_usd: cap,
    current_monthly_spend_usd: currentSpend,
    projected_spend_usd: currentSpend, // The request would have exceeded
    reset_at: resetDate.toISOString(),
    days_until_reset: daysUntilReset,
    _agent: {
      action: "adjust_cap",
      adjust_cap_url: `${appUrl}/settings?tab=billing`,
      retry_after_seconds: retryAfterSeconds,
    },
  };

  return NextResponse.json(body, {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "X-Monthly-Spend-Cap-USD": String(cap),
      "X-Current-Monthly-Spend-USD": String(currentSpend),
      "X-Monthly-Cap-Reset-At": resetDate.toISOString(),
      "X-Days-Until-Reset": String(daysUntilReset),
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

/**
 * Create standard error responses with agent-friendly metadata
 */
export function createAgentErrorResponse(
  status: number,
  errorCode: string,
  message: string,
  action: "retry" | "authenticate" | "top_up" | "upgrade" | "contact_support",
  details?: Record<string, any>,
): NextResponse {
  const body = {
    error: getErrorTitle(status),
    error_code: errorCode,
    message,
    _agent: {
      action,
      ...(action === "retry" && { retry_after_seconds: 60 }),
      ...(action === "authenticate" && {
        authenticate_url: "/api/auth/provision",
      }),
      ...(action === "top_up" && { top_up_url: "/api/billing/top-up" }),
      ...(action === "upgrade" && { upgrade_url: "/pricing" }),
      ...(action === "contact_support" && {
        support_email: "service@riskmodels.app",
      }),
    },
    ...(details && { details }),
  };

  return NextResponse.json(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(action === "retry" && { "Retry-After": "60" }),
    },
  });
}

function getErrorTitle(status: number): string {
  const titles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return titles[status] || "Error";
}

/**
 * Rate limit error response
 */
export function createRateLimitResponse(
  retryAfterSeconds: number,
  limit: number,
  remaining: number,
): NextResponse {
  return NextResponse.json(
    {
      error: "Too Many Requests",
      error_code: "RATE_LIMIT_EXCEEDED",
      message: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
      rate_limit: {
        limit,
        remaining: Math.max(0, remaining),
        reset_at: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
      },
      _agent: {
        action: "retry",
        retry_after_seconds: retryAfterSeconds,
      },
    },
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(Math.max(0, remaining)),
        "X-RateLimit-Reset": String(
          Math.floor(Date.now() / 1000) + retryAfterSeconds,
        ),
      },
    },
  );
}

/**
 * Authentication error response
 */
export function createAuthErrorResponse(
  message: string = "Authentication required",
): NextResponse {
  return createAgentErrorResponse(
    401,
    "UNAUTHORIZED",
    message,
    "authenticate",
    {
      auth_url: "/api/auth/provision",
      docs_url: "/docs/api/authentication",
    },
  );
}

/**
 * Capability not available error
 */
export function createCapabilityUnavailableResponse(
  capabilityId: string,
): NextResponse {
  return createAgentErrorResponse(
    503,
    "CAPABILITY_UNAVAILABLE",
    `The capability '${capabilityId}' is currently unavailable. Please try again later or use an alternative.`,
    "retry",
    {
      capability_id: capabilityId,
      health_check_url: "/api/health",
    },
  );
}
