import { createServer, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AuditLogger } from "./audit.js";
import {
  assertScopes,
  auditIdentity,
  AuthorizationDeniedError,
  canAccessDomain,
} from "./auth/authorization.js";
import { OidcTokenVerifier } from "./auth/token-verifier.js";
import { loadConfig, type DomainConfig } from "./config.js";
import { DomainDatabase } from "./database.js";
import { buildSelectQuery, buildInsertQuery, buildDeleteQuery, type WhereCondition } from "./query.js";

const whereConditionSchema = z.object({
  column: z.string().min(1).max(128),
  operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "like", "in", "isNull", "isNotNull"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(100)]).optional(),
});

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

const config = loadConfig();
const database = new DomainDatabase(config);
const audit = new AuditLogger(config.auditLogPath);
const authRequired = config.transport === "http";
const server = new McpServer({ name: "mysql-mcp", version: "0.2.0" });

function auditOutcome(error: unknown): "denied" | "error" {
  return error instanceof AuthorizationDeniedError ? "denied" : "error";
}

function getAuthorizedDomain(name: string, authInfo: Parameters<typeof canAccessDomain>[0]): DomainConfig {
  if (!authRequired) return database.getDomain(name);
  const domain = config.domains.find((candidate) => candidate.domain === name);
  if (!domain || !canAccessDomain(authInfo, domain, true)) {
    throw new AuthorizationDeniedError("요청한 DB 도메인을 사용할 권한이 없습니다.");
  }
  return domain;
}

server.registerTool("mysql_list_domains", {
  title: "MySQL 도메인 목록",
  description: "현재 사용자에게 접근이 허용된 MySQL 또는 MariaDB 도메인과 테이블 목록을 반환합니다.",
  inputSchema: {},
}, async (_args, extra) => {
  const identity = auditIdentity(extra.authInfo);
  try {
    assertScopes(extra.authInfo, config.oidc ? [config.oidc.metadataScope] : [], authRequired);
    const domains = config.domains
      .filter((domain) => canAccessDomain(extra.authInfo, domain, authRequired))
      .map(({ domain, engine, database: databaseName, allowedTables }) => ({ domain, engine, database: databaseName, allowedTables }));
    await audit.write({ domain: "*", operation: "list_domains", resultCount: domains.length, outcome: "success", identity });
    return jsonResult({ domains });
  } catch (error) {
    await audit.write({ domain: "*", operation: "list_domains", outcome: auditOutcome(error), identity }).catch(() => undefined);
    return errorResult(error);
  }
});

server.registerTool("mysql_list_tables", {
  title: "도메인 테이블 목록",
  description: "선택한 도메인에서 허용된 테이블의 실제 존재 여부를 반환합니다.",
  inputSchema: { domain: z.string().min(1).max(64) },
}, async ({ domain }, extra) => {
  const identity = auditIdentity(extra.authInfo);
  try {
    const selected = getAuthorizedDomain(domain, extra.authInfo);
    assertScopes(extra.authInfo, config.oidc ? [config.oidc.metadataScope, ...selected.requiredScopes] : [], authRequired);
    const rows = await database.listTables(domain);
    await audit.write({ domain, operation: "list_tables", resultCount: rows.length, outcome: "success", identity });
    return jsonResult({ domain, tables: rows });
  } catch (error) {
    await audit.write({ domain, operation: "list_tables", outcome: auditOutcome(error), identity }).catch(() => undefined);
    return errorResult(error);
  }
});

server.registerTool("mysql_describe_table", {
  title: "테이블 스키마 조회",
  description: "허용된 테이블의 컬럼, 데이터 형식, NULL 허용 여부와 키 정보를 반환합니다.",
  inputSchema: { domain: z.string().min(1).max(64), table: z.string().min(1).max(128) },
}, async ({ domain, table }, extra) => {
  const identity = auditIdentity(extra.authInfo);
  try {
    const selected = getAuthorizedDomain(domain, extra.authInfo);
    assertScopes(extra.authInfo, config.oidc ? [config.oidc.metadataScope, ...selected.requiredScopes] : [], authRequired);
    const rows = await database.describeTable(domain, table);
    await audit.write({ domain, operation: "describe_table", table, resultCount: rows.length, outcome: "success", identity });
    return jsonResult({ domain, table, columns: rows });
  } catch (error) {
    await audit.write({ domain, operation: "describe_table", table, outcome: auditOutcome(error), identity }).catch(() => undefined);
    return errorResult(error);
  }
});

server.registerTool("mysql_select", {
  title: "읽기 전용 SELECT",
  description: "허용된 테이블만 구조화된 조건으로 조회합니다. limit 기본값은 환경설정이며 절대 최대값은 1000입니다.",
  inputSchema: {
    domain: z.string().min(1).max(64),
    table: z.string().min(1).max(128),
    columns: z.array(z.string().min(1).max(128)).min(1).max(50).optional(),
    where: z.array(whereConditionSchema).min(1).max(20).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  },
}, async ({ domain, table, columns, where, limit }, extra) => {
  const identity = auditIdentity(extra.authInfo);
  const requestedLimit = limit ?? config.defaultLimit;
  try {
    const selected = getAuthorizedDomain(domain, extra.authInfo);
    assertScopes(extra.authInfo, config.oidc ? [config.oidc.readScope, ...selected.requiredScopes] : [], authRequired);
    if (requestedLimit > config.maxLimit) {
      throw new Error(`요청 limit은 설정된 최대값 ${config.maxLimit}을 초과할 수 없습니다.`);
    }
    if (requestedLimit > config.defaultLimit && (!where || where.length === 0)) {
      throw new Error("기본 limit을 초과하는 조회에는 하나 이상의 where 조건이 필요합니다.");
    }
    database.assertAllowedTable(domain, table);
    const query = buildSelectQuery({ table, columns, where: where as WhereCondition[] | undefined, limit: requestedLimit });
    const records = await database.select(domain, query.sql, query.values);
    await audit.write({ domain, operation: "select", table, requestedLimit, resultCount: records.length, outcome: "success", identity });
    return jsonResult({ domain, table, limit: requestedLimit, rowCount: records.length, rows: records });
  } catch (error) {
    await audit.write({ domain, operation: "select", table, requestedLimit, outcome: auditOutcome(error), identity }).catch(() => undefined);
    return errorResult(error);
  }
});

if (config.enableWrite) {
  server.registerTool("mysql_insert", {
    title: "데이터 삽입 (INSERT)",
    description: "허용된 테이블에 단일 레코드를 삽입합니다. 쓰기 권한이 필요합니다.",
    inputSchema: {
      domain: z.string().min(1).max(64),
      table: z.string().min(1).max(128),
      record: z.record(z.any()),
    },
  }, async ({ domain, table, record }, extra) => {
    const identity = auditIdentity(extra.authInfo);
    try {
      const selected = getAuthorizedDomain(domain, extra.authInfo);
      assertScopes(extra.authInfo, config.oidc ? [config.oidc.writeScope, ...selected.requiredScopes] : [], authRequired);
      database.assertAllowedTable(domain, table);
      const query = buildInsertQuery(table, record);
      const result = await database.execute(domain, query.sql, query.values);
      await audit.write({ domain, operation: "insert", table, resultCount: result.affectedRows, outcome: "success", identity });
      return jsonResult({ domain, table, affectedRows: result.affectedRows, insertId: result.insertId });
    } catch (error) {
      await audit.write({ domain, operation: "insert", table, outcome: auditOutcome(error), identity }).catch(() => undefined);
      return errorResult(error);
    }
  });

  server.registerTool("mysql_delete", {
    title: "데이터 삭제 (DELETE)",
    description: "허용된 테이블에서 지정된 조건에 만족하는 레코드를 삭제합니다. where 조건은 대형 사고를 막기 위해 반드시 필수입니다.",
    inputSchema: {
      domain: z.string().min(1).max(64),
      table: z.string().min(1).max(128),
      where: z.array(whereConditionSchema).min(1).max(20),
    },
  }, async ({ domain, table, where }, extra) => {
    const identity = auditIdentity(extra.authInfo);
    try {
      const selected = getAuthorizedDomain(domain, extra.authInfo);
      assertScopes(extra.authInfo, config.oidc ? [config.oidc.writeScope, ...selected.requiredScopes] : [], authRequired);
      database.assertAllowedTable(domain, table);
      const query = buildDeleteQuery(table, where as WhereCondition[]);
      const result = await database.execute(domain, query.sql, query.values);
      await audit.write({ domain, operation: "delete", table, resultCount: result.affectedRows, outcome: "success", identity });
      return jsonResult({ domain, table, affectedRows: result.affectedRows });
    } catch (error) {
      await audit.write({ domain, operation: "delete", table, outcome: auditOutcome(error), identity }).catch(() => undefined);
      return errorResult(error);
    }
  });
}

function originGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.header("origin");
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "invalid_origin", error_description: "허용되지 않은 Origin입니다." });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id");
      res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id, WWW-Authenticate");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

async function startHttp(): Promise<HttpServer> {
  if (!config.http || !config.oidc) throw new Error("HTTP/OIDC 설정이 필요합니다.");

  const publicUrl = new URL(config.http.publicUrl);
  const endpointPath = publicUrl.pathname === "/" ? "/mcp" : publicUrl.pathname.replace(/\/$/, "");
  const metadataPath = `/.well-known/oauth-protected-resource${endpointPath}`;
  const metadataUrl = new URL(metadataPath, publicUrl.origin).toString();
  const supportedScopes = [...new Set([
    config.oidc.accessScope,
    config.oidc.metadataScope,
    config.oidc.readScope,
    ...(config.enableWrite ? [config.oidc.writeScope] : []),
    ...config.domains.flatMap(({ requiredScopes }) => requiredScopes),
  ])];

  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.json({ status: "healthy", transport: "http" }));
  const metadata = {
    resource: config.http.publicUrl,
    authorization_servers: [config.oidc.issuer],
    scopes_supported: supportedScopes,
    bearer_methods_supported: ["header"],
  };
  app.get(metadataPath, (_req, res) => res.json(metadata));
  app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(metadata));

  const verifier = new OidcTokenVerifier(config.oidc);
  const bearerAuth = requireBearerAuth({
    verifier,
    requiredScopes: [config.oidc.accessScope],
    resourceMetadataUrl: metadataUrl,
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);

  app.all(
    endpointPath,
    originGuard(config.http.allowedOrigins),
    bearerAuth,
    express.json({ limit: "1mb", type: ["application/json", "application/*+json"] }),
    async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    },
  );

  const httpServer = createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.http!.port, config.http!.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  console.error(`mysql-mcp HTTP 서버 시작: ${config.http.host}:${config.http.port}${endpointPath}`);
  return httpServer;
}

async function main(): Promise<void> {
  let httpServer: HttpServer | undefined;
  if (config.transport === "stdio") {
    await server.connect(new StdioServerTransport());
  } else {
    httpServer = await startHttp();
  }

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    await database.close();
    await server.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MySQL MCP 시작 실패");
  process.exitCode = 1;
});
