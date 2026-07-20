import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("MySQL과 MariaDB 도메인을 독립 설정으로 읽는다", () => {
  const config = loadConfig({
    MYSQL_MCP_DOMAINS_JSON: JSON.stringify({
      domains: [
        { domain: "orders", engine: "mysql", host: "mysql-host", port: 3306, database: "orders", user: "readonly", passwordEnv: "ORDERS_PASSWORD", allowedTables: ["orders"] },
        { domain: "analytics", engine: "mariadb", host: "mariadb-host", port: 3307, database: "analytics", user: "readonly", passwordEnv: "ANALYTICS_PASSWORD", allowedTables: ["daily_metrics"] },
      ],
    }),
    ORDERS_PASSWORD: "configured",
    ANALYTICS_PASSWORD: "configured",
    MYSQL_MCP_DEFAULT_LIMIT: "100",
    MYSQL_MCP_MAX_LIMIT: "1000",
  });
  assert.deepEqual(config.domains.map(({ domain, engine }) => ({ domain, engine })), [
    { domain: "orders", engine: "mysql" },
    { domain: "analytics", engine: "mariadb" },
  ]);
  assert.equal(config.maxLimit, 1000);
  assert.equal(config.transport, "stdio");
  assert.equal(config.http, undefined);
});

test("HTTP 모드는 공개 URL과 OIDC 검증 설정을 필수로 요구한다", () => {
  const baseEnv = {
    MYSQL_MCP_DOMAINS_JSON: JSON.stringify({
      domains: [{
        domain: "orders",
        engine: "mysql",
        host: "mysql-host",
        port: 3306,
        database: "orders",
        user: "readonly",
        passwordEnv: "ORDERS_PASSWORD",
        allowedTables: ["orders"],
        requiredScopes: ["mysql:orders:read"],
      }],
    }),
    ORDERS_PASSWORD: "configured",
    MYSQL_MCP_TRANSPORT: "http",
  };
  assert.throws(() => loadConfig(baseEnv), /MYSQL_MCP_PUBLIC_URL/);

  const config = loadConfig({
    ...baseEnv,
    MYSQL_MCP_PUBLIC_URL: "https://mcp.example.invalid/mcp",
    MYSQL_MCP_OIDC_ISSUER: "https://iam.example.invalid/realms/example",
    MYSQL_MCP_OIDC_AUDIENCE: "https://mcp.example.invalid/mcp",
    MYSQL_MCP_OIDC_JWKS_URI: "https://iam.example.invalid/realms/example/protocol/openid-connect/certs",
    MYSQL_MCP_HTTP_ALLOWED_ORIGINS: "https://client.example.invalid",
  });
  assert.equal(config.transport, "http");
  assert.equal(config.http?.publicUrl, "https://mcp.example.invalid/mcp");
  assert.equal(config.oidc?.accessScope, "mysql:mcp");
  assert.deepEqual(config.http?.allowedOrigins, ["https://client.example.invalid"]);
  assert.deepEqual(config.domains[0].requiredScopes, ["mysql:orders:read"]);
});

test("Origin 허용 목록에 경로나 자격 증명이 포함된 URL을 거부한다", () => {
  const env = {
    MYSQL_MCP_DOMAINS_JSON: JSON.stringify({
      domains: [{ domain: "orders", engine: "mysql", host: "mysql-host", port: 3306, database: "orders", user: "readonly", passwordEnv: "ORDERS_PASSWORD", allowedTables: ["orders"] }],
    }),
    ORDERS_PASSWORD: "configured",
    MYSQL_MCP_TRANSPORT: "http",
    MYSQL_MCP_PUBLIC_URL: "https://mcp.example.invalid/mcp",
    MYSQL_MCP_OIDC_ISSUER: "https://iam.example.invalid/realms/example",
    MYSQL_MCP_OIDC_AUDIENCE: "https://mcp.example.invalid/mcp",
    MYSQL_MCP_OIDC_JWKS_URI: "https://iam.example.invalid/certs",
    MYSQL_MCP_HTTP_ALLOWED_ORIGINS: "https://client.example.invalid/path",
  };
  assert.throws(() => loadConfig(env), /Origin/);
});

test("원격 HTTP URL과 URL 내 자격 증명을 거부한다", () => {
  const env = {
    MYSQL_MCP_DOMAINS_JSON: JSON.stringify({
      domains: [{ domain: "orders", engine: "mysql", host: "mysql-host", port: 3306, database: "orders", user: "readonly", passwordEnv: "ORDERS_PASSWORD", allowedTables: ["orders"] }],
    }),
    ORDERS_PASSWORD: "configured",
    MYSQL_MCP_TRANSPORT: "http",
    MYSQL_MCP_PUBLIC_URL: "http://mcp.example.invalid/mcp",
    MYSQL_MCP_OIDC_ISSUER: "https://iam.example.invalid/realms/example",
    MYSQL_MCP_OIDC_AUDIENCE: "mysql-mcp",
    MYSQL_MCP_OIDC_JWKS_URI: "https://iam.example.invalid/certs",
  };
  assert.throws(() => loadConfig(env), /HTTPS URL/);
});

test("절대 조회 상한을 넘는 설정을 거부한다", () => {
  assert.throws(() => loadConfig({
    MYSQL_MCP_DOMAINS_JSON: JSON.stringify({
      domains: [{ domain: "orders", engine: "mysql", host: "mysql-host", port: 3306, database: "orders", user: "readonly", passwordEnv: "ORDERS_PASSWORD", allowedTables: ["orders"] }],
    }),
    ORDERS_PASSWORD: "configured",
    MYSQL_MCP_MAX_LIMIT: "1001",
  }));
});
