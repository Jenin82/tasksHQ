import { serveOAuthProtocol } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";
export const GET = serveOAuthProtocol;
export const HEAD = serveOAuthProtocol;
export const OPTIONS = serveOAuthProtocol;
