import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { OidcTokenVerifier } from "../src/auth/token-verifier.js";

test("OIDC access token의 서명, issuer, audience와 사용자 정보를 검증한다", async (context) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwksServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => jwksServer.close(() => resolve())));

  const address = jwksServer.address();
  if (!address || typeof address === "string") throw new Error("JWKS 테스트 서버 주소를 확인할 수 없습니다.");
  const issuer = `http://127.0.0.1:${address.port}/realms/example`;
  const audience = "https://mcp.example.invalid/mcp";
  const token = await new SignJWT({
    scope: "mysql:mcp mysql:read",
    azp: "example-client",
    preferred_username: "example-user",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("opaque-user-id")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const oidcConfig = {
    issuer,
    audience,
    jwksUri: `http://127.0.0.1:${address.port}/certs`,
    accessScope: "mysql:mcp",
    metadataScope: "mysql:metadata",
    readScope: "mysql:read",
    writeScope: "mysql:write",
    usernameClaim: "preferred_username",
  };
  const verifier = new OidcTokenVerifier(oidcConfig);
  const authInfo = await verifier.verifyAccessToken(token);
  assert.equal(authInfo.clientId, "example-client");
  assert.deepEqual(authInfo.scopes, ["mysql:mcp", "mysql:read"]);
  assert.deepEqual(authInfo.extra, {
    subject: "opaque-user-id",
    username: "example-user",
    issuer,
  });

  const wrongAudienceVerifier = new OidcTokenVerifier({
    ...oidcConfig,
    audience: "https://other.example.invalid/mcp",
  });
  await assert.rejects(() => wrongAudienceVerifier.verifyAccessToken(token), InvalidTokenError);
});
