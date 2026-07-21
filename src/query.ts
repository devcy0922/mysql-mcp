export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type WhereOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "isNull" | "isNotNull";

export interface WhereCondition {
  column: string;
  operator: WhereOperator;
  value?: string | number | boolean | null | Array<string | number | boolean>;
}

export interface SelectInput {
  table: string;
  columns?: string[];
  where?: WhereCondition[];
  limit: number;
}

export interface BuiltQuery {
  sql: string;
  values: Array<string | number | boolean | null>;
}

export function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error("식별자는 영문, 숫자, 밑줄만 사용할 수 있으며 숫자로 시작할 수 없습니다.");
  }
  return `\`${identifier}\``;
}

function buildCondition(condition: WhereCondition): BuiltQuery {
  const column = quoteIdentifier(condition.column);
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
  const operators: Record<Exclude<WhereOperator, "in" | "isNull" | "isNotNull">, string> = {
    eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE",
  };
  return { sql: `${column} ${operators[condition.operator]} ?`, values: [condition.value] };
}

export function quoteTableIdentifier(table: string): string {
  const parts = table.split(".");
  if (parts.length > 2 || parts.some((part) => !IDENTIFIER_PATTERN.test(part))) {
    throw new Error("식별자는 영문, 숫자, 밑줄만 사용할 수 있으며 숫자로 시작할 수 없습니다.");
  }
  return parts.map((part) => `\`${part}\``).join(".");
}

export function buildSelectQuery(input: SelectInput): BuiltQuery {
  const columns = input.columns?.length ? input.columns.map(quoteIdentifier).join(", ") : "*";
  const conditions = input.where?.map(buildCondition) ?? [];
  const where = conditions.length ? ` WHERE ${conditions.map(({ sql }) => sql).join(" AND ")}` : "";
  return {
    sql: `SELECT ${columns} FROM ${quoteTableIdentifier(input.table)}${where} LIMIT ?`,
    values: [...conditions.flatMap(({ values }) => values), input.limit],
  };
}

export function buildInsertQuery(table: string, record: Record<string, unknown>): BuiltQuery {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    throw new Error("삽입할 레코드에 하나 이상의 필드가 필요합니다.");
  }
  if (keys.length > 50) {
    throw new Error("한 번에 삽입할 수 있는 필드는 최대 50개입니다.");
  }
  const columns = keys.map(quoteIdentifier).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const values = keys.map((k) => {
    const val = record[k];
    if (typeof val === "object" && val !== null && !(val instanceof Date)) {
      return JSON.stringify(val);
    }
    return val as any;
  });
  return {
    sql: `INSERT INTO ${quoteTableIdentifier(table)} (${columns}) VALUES (${placeholders})`,
    values,
  };
}

export function buildDeleteQuery(table: string, where: WhereCondition[]): BuiltQuery {
  if (!where || where.length === 0) {
    throw new Error("DELETE 쿼리에는 최소 하나 이상의 where 조건이 반드시 필요합니다.");
  }
  if (where.length > 20) {
    throw new Error("DELETE 쿼리의 where 조건은 최대 20개까지만 지정할 수 있습니다.");
  }
  const conditions = where.map(buildCondition);
  return {
    sql: `DELETE FROM ${quoteTableIdentifier(table)} WHERE ${conditions.map(({ sql }) => sql).join(" AND ")}`,
    values: conditions.flatMap(({ values }) => values),
  };
}
