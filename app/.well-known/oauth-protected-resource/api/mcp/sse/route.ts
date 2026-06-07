/**
 * GET /.well-known/oauth-protected-resource/api/mcp/sse
 *
 * Path-suffixed variant of the RFC 9728 protected-resource metadata. Per the
 * MCP Authorization spec some clients build the well-known URL by inserting the
 * protected resource's path (`/api/mcp/sse`) after `/.well-known/...`. Serve the
 * identical document from both locations. Single source of truth: the parent
 * `oauth-protected-resource/route.ts`.
 */
export { GET, dynamic } from "../../../route";
