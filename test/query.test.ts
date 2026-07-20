import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectQuery, quoteIdentifier } from "../src/query.js";

test("SELECT는 값 바인딩과 기본 식별자 인용을 사용한다", () => {
  const result = buildSelectQuery({
    table: "orders",
    columns: ["id", "status"],
    where: [{ column: "status", operator: "eq", value: "paid" }],
    limit: 1000,
  });
  assert.equal(result.sql, "SELECT `id`, `status` FROM `orders` WHERE `status` = ? LIMIT ?");
  assert.deepEqual(result.values, ["paid", 1000]);
});

test("IN 및 NULL 조건을 파라미터화한다", () => {
  const result = buildSelectQuery({
    table: "orders",
    where: [{ column: "state", operator: "in", value: ["paid", "ready"] }, { column: "deleted_at", operator: "isNull" }],
    limit: 100,
  });
  assert.equal(result.sql, "SELECT * FROM `orders` WHERE `state` IN (?, ?) AND `deleted_at` IS NULL LIMIT ?");
  assert.deepEqual(result.values, ["paid", "ready", 100]);
});

test("안전하지 않은 식별자는 거부한다", () => {
  assert.throws(() => quoteIdentifier("orders; DROP TABLE orders"));
});
