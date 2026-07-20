import assert from "node:assert/strict";
import test from "node:test";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  assertScopes,
  auditIdentity,
  AuthorizationDeniedError,
  canAccessDomain,
  hasRequiredScopes,
} from "../src/auth/authorization.js";
import type { DomainConfig } from "../src/config.js";

const authInfo: AuthInfo = {
  token: "not-logged-token",
  clientId: "example-client",
  scopes: ["mysql:mcp", "mysql:read", "mysql:orders:read"],
  extra: { subject: "user-id", username: "example-user" },
};

const domain: DomainConfig = {
  domain: "orders",
  engine: "mysql",
  host: "mysql-host",
  port: 3306,
  database: "orders",
  user: "readonly",
  passwordEnv: "ORDERS_PASSWORD",
  allowedTables: ["orders"],
  requiredScopes: ["mysql:orders:read"],
};

test("필수 scope를 모두 가진 사용자만 도메인에 접근한다", () => {
  assert.equal(hasRequiredScopes(authInfo.scopes, ["mysql:read", "mysql:orders:read"]), true);
  assert.equal(canAccessDomain(authInfo, domain, true), true);
  assert.equal(canAccessDomain({ ...authInfo, scopes: ["mysql:read"] }, domain, true), false);
});

test("HTTP 모드에서 인증 또는 scope 누락을 거부한다", () => {
  assert.throws(() => assertScopes(undefined, ["mysql:read"], true), AuthorizationDeniedError);
  assert.throws(() => assertScopes(authInfo, ["mysql:metadata"], true), AuthorizationDeniedError);
  assert.doesNotThrow(() => assertScopes(undefined, ["mysql:read"], false));
});

test("감사 식별자는 토큰을 제외하고 사용자와 클라이언트만 반환한다", () => {
  assert.deepEqual(auditIdentity(authInfo), {
    authMode: "oidc",
    subject: "user-id",
    username: "example-user",
    clientId: "example-client",
  });
});
