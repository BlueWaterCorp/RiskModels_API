import { User } from '@supabase/supabase-js';
import { createClient as createServerClient } from './server';
import { createAdminClient } from './admin';
import { cookies } from 'next/headers';

/**
 * Authenticate user for API routes with three-tier support:
 * 1. rm_agent_* / rm_user_* API keys  (for external API callers)
 * 2. Supabase JWT Bearer token         (for browser/session callers)
 * 3. Cookie-based auth                 (for SSR pages)
 * 
 * Also enforces rate limiting for API key authentication.
 */
export async function authenticateRequest(request: Request): Promise<{ user: User | null; error: string | null }> {
  console.debug('[Auth] authenticateRequest called');

  const authHeader = request.headers.get('authorization');
  console.debug('[Auth] Authorization header present:', !!authHeader);

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();

    // 1. Try RiskModels API key (rm_agent_* or rm_user_*)
    // Legacy marketing string — never registered as rm_user_* / rm_agent_*
    if (token.startsWith('rm_demo_')) {
      return {
        user: null,
        error:
          'Public demo keys (rm_demo_*) are not valid for authenticated API routes. Get an API key at https://riskmodels.app/get-key (rm_user_* / rm_agent_*).',
      };
    }

    if (token.startsWith('rm_agent_') || token.startsWith('rm_user_')) {
      try {
        const { validateApiKey } = await import('@/lib/agent/api-keys');
        const validation = await validateApiKey(token);
        if (validation.valid && validation.userId) {
          // Check rate limit for this API key
          const { checkRateLimit, getRateLimitForKey } = await import('@/lib/agent/rate-limiter');
          const rateLimit = getRateLimitForKey(validation.scopes);
          const rateLimitResult = await checkRateLimit(token, rateLimit);
          
          if (!rateLimitResult.allowed) {
            return { 
              user: null, 
              error: `Rate limit exceeded. Try again at ${rateLimitResult.resetAt.toISOString()}` 
            };
          }
          
          // Fetch the full user record so callers get email and other fields
          try {
            const supabaseAdmin = createAdminClient();
            const { data: { user: fullUser } } = await supabaseAdmin.auth.admin.getUserById(validation.userId);
            if (fullUser) {
              console.debug('[Auth] API key authentication successful (full user)');
              return { user: fullUser, error: null };
            }
          } catch {
            // Fall back to synthetic user if admin lookup fails
          }
          const syntheticUser = { id: validation.userId } as User;
          console.debug('[Auth] API key authentication successful (synthetic user)');
          return { user: syntheticUser, error: null };
        }
        console.debug('[Auth] API key invalid:', validation.error);
        return { user: null, error: validation.error ?? 'Invalid API key' };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.debug('[Auth] API key lookup failed:', message);
        return { user: null, error: `API key authentication failed: ${message}` };
      }
    }

    // 2. Supabase JWT Bearer token
    try {
      const supabaseAdmin = createAdminClient();
      const { data: { user: tokenUser }, error: tokenError } = await supabaseAdmin.auth.getUser(token);
      if (tokenUser && !tokenError) {
        console.debug('[Auth] Bearer token authentication successful');
        return { user: tokenUser, error: null };
      } else if (tokenError) {
        console.debug('[Auth] Bearer token invalid:', tokenError.message);
        return { user: null, error: `Bearer token invalid: ${tokenError.message}` };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.debug('[Auth] Bearer token auth failed:', message);
      return { user: null, error: `Bearer token authentication failed: ${message}` };
    }
  }
  
  // Method 2: Fallback to cookie-based auth (for SSR pages, not API routes)
  // Only try cookie auth if no Bearer token was provided
  if (!authHeader) {
    console.debug('[Auth] No Bearer token, trying cookie auth');
    try {
      const cookieStore = await cookies();
      console.debug('[Auth] Cookie store obtained, cookies count:', cookieStore.getAll().length);
      
      const supabase = await createServerClient();
      const { data: { user: cookieUser }, error: cookieError } = await supabase.auth.getUser();
      
      console.debug('[Auth] Cookie auth result:', { hasUser: !!cookieUser, error: cookieError?.message });
      
      if (cookieUser && !cookieError) {
        console.debug('[Auth] Cookie-based authentication successful');
        return { user: cookieUser, error: null };
      } else if (cookieError) {
        return { user: null, error: `Cookie auth failed: ${cookieError.message}` };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.debug('[Auth] Cookie auth failed:', message);
      return { user: null, error: `Cookie auth failed: ${message}` };
    }
  }
  
  // No valid authentication method found
  return { user: null, error: 'No valid authentication method found' };
}

/**
 * Validate that an authenticated user has access to a specific capability/scope.
 * Used for scope-based access control on API keys.
 */
export async function validateScope(
  userId: string,
  requiredCapabilityId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Import capabilities validation
    const { validateCapabilityAccess } = await import('@/lib/agent/capabilities');
    
    // Get user's API key scopes (if authenticated via API key)
    const { validateApiKey } = await import('@/lib/agent/api-keys');
    
    // For now, we'll assume users authenticated via session/JWT have full access
    // In the future, we can check profiles table for role-based access
    const supabaseAdmin = createAdminClient();
    const { data: apiKeys } = await supabaseAdmin
      .from('agent_api_keys')
      .select('scopes')
      .eq('user_id', userId)
      .eq('revoked', false)
      .limit(1)
      .maybeSingle();
    
    if (!apiKeys) {
      // No API key found, assume full access (session-based auth)
      return { valid: true };
    }
    
    const scopes = apiKeys.scopes as string[] | undefined;
    const hasAccess = validateCapabilityAccess(requiredCapabilityId, scopes);
    
    if (!hasAccess) {
      return { 
        valid: false, 
        error: `Access denied: capability ${requiredCapabilityId} not in allowed scopes` 
      };
    }
    
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Auth] Scope validation error:', err);
    return { valid: false, error: `Scope validation failed: ${message}` };
  }
}
