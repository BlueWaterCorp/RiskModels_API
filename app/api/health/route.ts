/**
 * Health Check Endpoint
 *
 * Returns real-time health status of all API services and capabilities.
 * Used by agents to evaluate service reliability before making requests.
 *
 * GET /api/health
 */

import { NextResponse } from 'next/server';
import { getHealthStatus } from '@/lib/agent/telemetry';
import { getRiskMetadata } from '@/lib/dal/risk-metadata';
import { addMetadataHeaders } from '@/lib/dal/response-headers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Returns current health status of the API and all capabilities.
 * Unauthenticated endpoint with short cache TTL.
 */
export async function GET() {
  try {
    const health = await getHealthStatus();

    // Determine appropriate status code based on health
    const statusCode = health.status === 'down' ? 503 : health.status === 'degraded' ? 200 : 200;

    const response = NextResponse.json(health, {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, s-maxage=30',
        'Access-Control-Allow-Origin': '*',
      },
    });

    const metadata = await getRiskMetadata();
    addMetadataHeaders(response, metadata);
    return response;
  } catch (error) {
    console.error('[Health] Error getting health status:', error);

    const response = NextResponse.json(
      {
        status: 'down',
        timestamp: new Date().toISOString(),
        version: process.env.API_VERSION || '2.0.0-agent',
        error: 'Failed to retrieve health status',
        services: {},
        capabilities: {},
      },
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );

    try {
      const metadata = await getRiskMetadata();
      addMetadataHeaders(response, metadata);
    } catch (metaError) {
      console.warn('[Health] Failed to add metadata headers to error response', metaError);
    }

    return response;
  }
}

/**
 * OPTIONS /api/health
 *
 * Handle CORS preflight requests.
 */
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
