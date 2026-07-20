import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import type { DomainConfig, ServiceConfig } from "./config.js";

export class DomainDatabase {
  private readonly pools = new Map<string, Pool>();

  public constructor(private readonly config: ServiceConfig, private readonly env: NodeJS.ProcessEnv = process.env) {}

  public getDomain(name: string): DomainConfig {
    const domain = this.config.domains.find((candidate) => candidate.domain === name);
    if (!domain) throw new Error(`허용되지 않은 도메인입니다: ${name}`);
    return domain;
  }

  public getPool(name: string): Pool {
    const existing = this.pools.get(name);
    if (existing) return existing;
    const domain = this.getDomain(name);
    const options: PoolOptions = {
      host: domain.host,
      port: domain.port,
      database: domain.database,
      user: domain.user,
      password: this.env[domain.passwordEnv],
      waitForConnections: true,
      connectionLimit: this.config.connectionLimit,
      enableKeepAlive: true,
      connectTimeout: this.config.queryTimeoutMs,
      ssl: domain.ssl,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
    const pool = mysql.createPool(options);
    this.pools.set(name, pool);
    return pool;
  }

  public assertAllowedTable(domainName: string, table: string): void {
    const domain = this.getDomain(domainName);
    if (domain.allowedTables.includes("*")) {
      return;
    }
    if (!domain.allowedTables.includes(table)) {
      throw new Error(`도메인 ${domainName}에서 테이블 ${table} 조회는 허용되지 않았습니다.`);
    }
  }

  public async listTables(domain: string): Promise<RowDataPacket[]> {
    const selected = this.getDomain(domain);
    const useWildcard = selected.allowedTables.includes("*");
    const sql = useWildcard
      ? "SELECT table_schema AS tableSchema, table_name AS tableName, table_type AS tableType FROM information_schema.tables WHERE table_schema IN (?, 'SYSTEM_LOGS') ORDER BY table_schema, table_name"
      : "SELECT table_schema AS tableSchema, table_name AS tableName, table_type AS tableType FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?) ORDER BY table_schema, table_name";
    const values = useWildcard ? [selected.database] : [selected.database, selected.allowedTables];
    const [rows] = await this.getPool(domain).query<RowDataPacket[]>({
      sql,
      values,
      timeout: this.config.queryTimeoutMs,
    });
    return rows;
  }

  public async describeTable(domain: string, table: string): Promise<RowDataPacket[]> {
    this.assertAllowedTable(domain, table);
    const selected = this.getDomain(domain);
    const parts = table.split(".");
    const schemaName = parts.length === 2 ? parts[0] : selected.database;
    const tableName = parts.length === 2 ? parts[1] : table;
    const [rows] = await this.getPool(domain).query<RowDataPacket[]>({
      sql: "SELECT column_name AS columnName, data_type AS dataType, is_nullable AS isNullable, column_key AS columnKey FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
      values: [schemaName, tableName],
      timeout: this.config.queryTimeoutMs,
    });
    return rows;
  }

  public async select(domain: string, sql: string, values: unknown[]): Promise<RowDataPacket[]> {
    const [rows] = await this.getPool(domain).query<RowDataPacket[]>({
      sql,
      values,
      timeout: this.config.queryTimeoutMs,
    });
    return rows;
  }

  public async close(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.end()));
  }
}
