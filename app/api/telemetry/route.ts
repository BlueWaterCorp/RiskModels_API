/**
 * Telemetry API
 *
 * Get detailed performance metrics for API capabilities.
 * Agents use this to evaluate service reliability.
 *
 * GET /api/telemetry?capability={id}&days={30}
 *
 * Returns: Performance metrics, uptime, latency percentiles
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTelemetryMetrics, getHealthStatus } from '@/lib/agent/telemetry';
import { getCapability } from '@/lib/agent/capabilities';
import { getOrCompute, generateCacheKey, CACHE_TTL } from '@/lib/cache/redis';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const capabilityId = searchParams.get('capability');
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get('days') || '30')));

    // If no capability specified, return overall health
    if (!capabilityId) {
      const health = await getHealthStatus();

      return NextResponse.json(
        {
          ...health,
          _agent: {
            latency_ms: Date.now() - startTime,
          },
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=30, s-maxage=30',
          },
        }
      );
    }

    // Validate capability
    const capability = getCapability(capabilityId);
    if (!capability) {
      return NextResponse.json(
        {
          error: 'Capability not found',
          available_capabilities: [
            'ticker-returns',
            'returns',
            'etf-returns',
            'l3-decomposition',
            'tickers-list',
            'chat-risk-analyst',
          ],
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 404 }
      );
    }

    // Get cached metrics or compute
    const cacheKey = generateCacheKey('telemetry', capabilityId, { days });

    const metrics = await getOrCompute(
      cacheKey,
      async () => {
        const telemetry = await getTelemetryMetrics(capabilityId, days);

        if (!telemetry) {
          // Return default metrics if no data
          return {
            capability_id: capabilityId,
            period: `${days}d`,
            requests_total: 0,
            requests_success: 0,
            requests_failed: 0,
            success_rate: 1,
            latency_avg_ms: capability.performance.avg_latency_ms,
            latency_p50_ms: capability.performance.avg_latency_ms,
            latency_p95_ms: capability.performance.p95_latency_ms,
            latency_p99_ms: capability.performance.p95_latency_ms * 1.2,
            latency_max_ms: capability.performance.p95_latency_ms * 1.5,
            revenue_usd: 0,
          };
        }

        return telemetry;
      },
      CACHE_TTL.FREQUENT // 5 minute cache
    );

    return NextResponse.json(
      {
        ...metrics,
        capability: {
          id: capability.id,
          name: capability.name,
          pricing: capability.pricing,
          performance: capability.performance,
          confidence: capability.confidence,
        },
        _agent: {
          latency_ms: Date.now() - startTime,
          cache_status: 'MISS', // Will be updated if cached
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300',
        },
      }
    );
  } catch (error) {
    console.error('[Telemetry API] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve telemetry',
        message: error instanceof Error ? error.message : 'Unknown error',
        _agent: { latency_ms: Date.now() - startTime },
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
