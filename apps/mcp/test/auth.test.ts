import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import { MCP_URL, rpc } from "./helpers";

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const METADATA =
  "https://mcp.example.test/.well-known/oauth-protected-resource/mcp";

it("answers an unauthenticated request 401 with a Bearer challenge naming the metadata", async () => {
  const response = await rpc(null, LIST);
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(
    `Bearer realm="OAuth", resource_metadata="${METADATA}"`,
  );
});

it("answers a token the authorization server rejects 401 invalid_token", async () => {
  const response = await rpc("not-a-real-token", LIST);
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(
    `Bearer realm="OAuth", resource_metadata="${METADATA}", error="invalid_token"`,
  );
});

it("publishes RFC 9728 metadata pointing at the web issuer", async () => {
  const response = await SELF.fetch(METADATA);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    resource: MCP_URL,
    authorization_servers: ["https://taskshq.example.test"],
  });
});

it("serves nothing outside the resource path", async () => {
  const response = await SELF.fetch("https://mcp.example.test/other");
  expect(response.status).toBe(404);
});
