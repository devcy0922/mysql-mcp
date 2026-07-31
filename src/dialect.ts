import type { BuiltQuery, SelectInput, WhereCondition } from "./query.js";

export type DatabaseEngine = "mysql" | "mariadb" | "postgres" | "sqlite";

export interface DatabaseDialect {
  readonly engine: DatabaseEngine;
  quoteIdentifier(identifier: string): string;
  quoteTableIdentifier(table: string): string;
  buildSelectQuery(input: SelectInput): BuiltQuery;
  buildExplainQuery(input: SelectInput, format?: "TRADITIONAL" | "JSON"): BuiltQuery;
}

export class MySqlDialect implements DatabaseDialect {
  public readonly engine: DatabaseEngine;

  public constructor(engine: DatabaseEngine = "mysql") {
    this.engine = engine;
  }

  public quoteIdentifier(identifier: string): string {
    const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (!IDENTIFIER_PATTERN.test(identifier)) {
      throw new Error("식별자는 영문, 숫자, 밑줄만 사용할 수 있으며 숫자로 시작할 수 없습니다.");
    }
    return `\`${identifier}\``;
  }

  public quoteTableIdentifier(table: string): string {
    const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const parts = table.split(".");
    if (parts.length > 2 || parts.some((part) => !IDENTIFIER_PATTERN.test(part))) {
      throw new Error("식별자는 영문, 숫자, 밑줄만 사용할 수 있으며 숫자로 시작할 수 없습니다.");
    }
    return parts.map((part) => `\`${part}\``).join(".");
  }

  private buildCondition(condition: WhereCondition): BuiltQuery {
    const column = this.quoteIdentifier(condition.column);
    if (condition.operator === "isNull") return { sql: `${column} IS NULL`, values: [] };
    if (condition.operator === "isNotNull") return { sql: `${column} IS NOT NULL`, values: [] };
    if (condition.operator === "in") {
      if (!Array.isArray(condition.value) || condition.value.length === 0 || condition.value.length > 100) {
        throw new Error("in 조건의 value는 1~100개 배열이어야 합니다.");
      }
      return { sql: `${column} IN (${condition.value.map(() => "?").join(", ")})`, values: condition.value };
    }
    if (Array.isArray(condition.value) || condition.value === undefined) {
      throw new Error(`${condition.operator} 조건에는 단일 value가 필요합니다.`);
    }
    const operators: Record<string, string> = {
      eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE",
    };
    return { sql: `${column} ${operators[condition.operator]} ?`, values: [condition.value] };
  }

  public buildSelectQuery(input: SelectInput): BuiltQuery {
    const columns = input.columns?.length ? input.columns.map((c) => this.quoteIdentifier(c)).join(", ") : "*";
    const conditions = input.where?.map((w) => this.buildCondition(w)) ?? [];
    const where = conditions.length ? ` WHERE ${conditions.map(({ sql }) => sql).join(" AND ")}` : "";
    return {
      sql: `SELECT ${columns} FROM ${this.quoteTableIdentifier(input.table)}${where} LIMIT ?`,
      values: [...conditions.flatMap(({ values }) => values), input.limit],
    };
  }

  public buildExplainQuery(input: SelectInput, format: "TRADITIONAL" | "JSON" = "TRADITIONAL"): BuiltQuery {
    const selectQuery = this.buildSelectQuery(input);
    const prefix = format === "JSON" ? "EXPLAIN FORMAT=JSON " : "EXPLAIN ";
    return {
      sql: `${prefix}${selectQuery.sql}`,
      values: selectQuery.values,
    };
  }
}
