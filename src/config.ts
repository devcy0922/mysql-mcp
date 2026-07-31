import type { SslOptions } from "mysql2";

const MAX_SELECT_LIMIT = 1000;
const DEFAULT_SELECT_LIMIT = 100;

export type DatabaseEngine = "mysql" | "mariadb" | "postgres" | "sqlite";

export interface DomainConfig {
  domain: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  passwordEnv: string;
  allowedTables: string[];
  requiredScopes: string[];
  ssl?: SslOptions;
}

export interface HttpConfig {
  host: string;
  port: number;
  publicUrl: string;
  allowedOrigins: string[];
}

export interface OidcConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  accessScope: string;
  metadataScope: string;
  readScope: string;
  writeScope: string;
  usernameClaim: string;
}

export interface ServiceConfig {
  domains: DomainConfig[];
  transport: "stdio" | "http";
  http?: HttpConfig;
  oidc?: OidcConfig;
  defaultLimit: number;
  maxLimit: number;
  connectionLimit: number;
  queryTimeoutMs: number;
  auditLogPath: string;
  enableWrite: boolean;
}

interface DomainsDocument {
  domains: Array<Record<string, unknown>>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`MYSQL_MCP_DOMAINS_JSON의 ${field} 값이 필요합니다.`);
  }
  return value.trim();
}

function parsePort(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`MYSQL_MCP_DOMAINS_JSON의 ${field} 값은 1~65535 정수여야 합니다.`);
  }
  return value;
}

function parseAllowedTables(value: unknown, domain: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((table) => typeof table !== "string" || table.trim() === "")) {
    throw new Error(`도메인 ${domain}에는 하나 이상의 allowedTables 값이 필요합니다.`);
  }
  return [...new Set(value.map((table) => (table as string).trim()))];
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new Error(`${field} 값은 비어 있지 않은 문자열 배열이어야 합니다.`);
  }
  return [...new Set(value.map((entry) => (entry as string).trim()))];
}

function parseSsl(value: unknown, domain: string): SslOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`도메인 ${domain}의 ssl 값은 객체여야 합니다.`);
  }
  const source = value as Record<string, unknown>;
  if (typeof source.rejectUnauthorized !== "boolean") {
    throw new Error(`도메인 ${domain}의 ssl.rejectUnauthorized 불리언 값이 필요합니다.`);
  }
  return { rejectUnauthorized: source.rejectUnauthorized };
}

function parseDomain(value: Record<string, unknown>): DomainConfig {
  const domain = requireString(value.domain, "domains[].domain");
  const engine = requireString(value.engine, `domains[${domain}].engine`);
  const validEngines: DatabaseEngine[] = ["mysql", "mariadb", "postgres", "sqlite"];
  if (!validEngines.includes(engine as DatabaseEngine)) {
    throw new Error(`도메인 ${domain}의 engine은 mysql, mariadb, postgres, sqlite 중 하나여야 합니다.`);
  }
  return {
    domain,
    engine: engine as DatabaseEngine,
    host: requireString(value.host, `domains[${domain}].host`),
    port: parsePort(value.port, `domains[${domain}].port`),
    database: requireString(value.database, `domains[${domain}].database`),
    user: requireString(value.user, `domains[${domain}].user`),
    passwordEnv: requireString(value.passwordEnv, `domains[${domain}].passwordEnv`),
    allowedTables: parseAllowedTables(value.allowedTables, domain),
    requiredScopes: parseStringArray(value.requiredScopes, `domains[${domain}].requiredScopes`),
    ssl: parseSsl(value.ssl, domain),
  };
}

function readInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 값은 ${min}~${max} 정수여야 합니다.`);
  }
  return value;
}

function readTransport(env: NodeJS.ProcessEnv): "stdio" | "http" {
  const transport = (env.MYSQL_MCP_TRANSPORT ?? "stdio").trim().toLowerCase();
  if (transport !== "stdio" && transport !== "http") {
    throw new Error("MYSQL_MCP_TRANSPORT 값은 stdio 또는 http여야 합니다.");
  }
  return transport;
}

function requireUrl(env: NodeJS.ProcessEnv, name: string, options: { allowHttpLocalhost?: boolean } = {}): string {
  const value = requireString(env[name], name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} 값은 유효한 URL이어야 합니다.`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${name} 값에는 사용자 정보나 fragment를 포함할 수 없습니다.`);
  }
  const localHttp = options.allowHttpLocalhost === true
    && url.protocol === "http:"
    && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`${name} 값은 HTTPS URL이어야 합니다. 로컬 테스트에서는 localhost HTTP만 허용됩니다.`);
  }
  return url.toString().replace(/\/$/, "");
}

function readOrigins(env: NodeJS.ProcessEnv, name: string): string[] {
  const raw = env[name];
  if (!raw) return [];
  return [...new Set(raw.split(",").map((value) => {
    const candidate = value.trim();
    if (!candidate) return "";
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(`${name}에는 유효한 HTTP(S) Origin만 입력할 수 있습니다.`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error(`${name}에는 경로·쿼리·자격 증명 없는 HTTP(S) Origin만 입력할 수 있습니다.`);
    }
    return url.origin;
  }).filter(Boolean))];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const raw = env.MYSQL_MCP_DOMAINS_JSON;
  if (!raw) throw new Error("MYSQL_MCP_DOMAINS_JSON 환경 변수가 필요합니다.");

  let document: DomainsDocument;
  try {
    document = JSON.parse(raw) as DomainsDocument;
  } catch {
    throw new Error("MYSQL_MCP_DOMAINS_JSON은 유효한 JSON이어야 합니다.");
  }
  if (!Array.isArray(document.domains) || document.domains.length === 0) {
    throw new Error("MYSQL_MCP_DOMAINS_JSON에는 비어 있지 않은 domains 배열이 필요합니다.");
  }

  const domains = document.domains.map(parseDomain);
  if (new Set(domains.map(({ domain }) => domain)).size !== domains.length) {
    throw new Error("도메인 이름은 중복될 수 없습니다.");
  }
  for (const domain of domains) {
    if (!env[domain.passwordEnv]) {
      throw new Error(`도메인 ${domain.domain}의 비밀번호 환경 변수 ${domain.passwordEnv}가 설정되지 않았습니다.`);
    }
  }

  const defaultLimit = readInteger(env, "MYSQL_MCP_DEFAULT_LIMIT", DEFAULT_SELECT_LIMIT, 1, MAX_SELECT_LIMIT);
  const configuredMax = readInteger(env, "MYSQL_MCP_MAX_LIMIT", MAX_SELECT_LIMIT, defaultLimit, MAX_SELECT_LIMIT);
  const transport = readTransport(env);
  const http = transport === "http" ? {
    host: env.MYSQL_MCP_HTTP_HOST?.trim() || "127.0.0.1",
    port: readInteger(env, "MYSQL_MCP_HTTP_PORT", 3333, 1, 65535),
    publicUrl: requireUrl(env, "MYSQL_MCP_PUBLIC_URL", { allowHttpLocalhost: true }),
    allowedOrigins: readOrigins(env, "MYSQL_MCP_HTTP_ALLOWED_ORIGINS"),
  } : undefined;
  if (http && new URL(http.publicUrl).pathname === "/") {
    throw new Error("MYSQL_MCP_PUBLIC_URL에는 MCP 엔드포인트 경로가 필요합니다. 예: https://mcp.example.invalid/mcp");
  }
  const oidc = transport === "http" ? {
    issuer: requireUrl(env, "MYSQL_MCP_OIDC_ISSUER", { allowHttpLocalhost: true }),
    audience: requireString(env.MYSQL_MCP_OIDC_AUDIENCE, "MYSQL_MCP_OIDC_AUDIENCE"),
    jwksUri: requireUrl(env, "MYSQL_MCP_OIDC_JWKS_URI", { allowHttpLocalhost: true }),
    accessScope: env.MYSQL_MCP_OIDC_ACCESS_SCOPE?.trim() || "mysql:mcp",
    metadataScope: env.MYSQL_MCP_OIDC_METADATA_SCOPE?.trim() || "mysql:metadata",
    readScope: env.MYSQL_MCP_OIDC_READ_SCOPE?.trim() || "mysql:read",
    writeScope: env.MYSQL_MCP_OIDC_WRITE_SCOPE?.trim() || "mysql:write",
    usernameClaim: env.MYSQL_MCP_OIDC_USERNAME_CLAIM?.trim() || "preferred_username",
  } : undefined;
  const enableWrite = env.MYSQL_MCP_ENABLE_WRITE?.trim().toLowerCase() === "true";
  return {
    domains,
    transport,
    http,
    oidc,
    defaultLimit,
    maxLimit: configuredMax,
    connectionLimit: readInteger(env, "MYSQL_MCP_CONNECTION_LIMIT", 5, 1, 20),
    queryTimeoutMs: readInteger(env, "MYSQL_MCP_QUERY_TIMEOUT_MS", 10_000, 1_000, 60_000),
    auditLogPath: env.MYSQL_MCP_AUDIT_LOG_PATH ?? "/var/lib/mcp/logs/mysql-audit.jsonl",
    enableWrite,
  };
}
