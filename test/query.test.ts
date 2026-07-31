import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectQuery, buildExplainQuery, buildInsertQuery, buildDeleteQuery, quoteIdentifier } from "../src/query.js";

test("EXPLAIN TRADITIONAL 및 JSON 형태 생성을 검증한다", () => {
  const result = buildExplainQuery({
    table: "orders",
    columns: ["id", "status"],
    where: [{ column: "status", operator: "eq", value: "paid" }],
    limit: 1000,
  });
  assert.equal(result.sql, "EXPLAIN SELECT `id`, `status` FROM `orders` WHERE `status` = ? LIMIT ?");
  assert.deepEqual(result.values, ["paid", 1000]);

  const jsonResult = buildExplainQuery({
    table: "orders",
    where: [{ column: "id", operator: "eq", value: 1 }],
    limit: 10,
  }, "JSON");
  assert.equal(jsonResult.sql, "EXPLAIN FORMAT=JSON SELECT * FROM `orders` WHERE `id` = ? LIMIT ?");
  assert.deepEqual(jsonResult.values, [1, 10]);
});

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

test("buildInsertQuery는 INSERT 문을 올바르게 빌드한다", () => {
  const result = buildInsertQuery("orders", { status: "paid", amount: 250 });
  assert.equal(result.sql, "INSERT INTO `orders` (`status`, `amount`) VALUES (?, ?)");
  assert.deepEqual(result.values, ["paid", 250]);
});

test("buildInsertQuery는 필드가 비어있으면 거부한다", () => {
  assert.throws(() => buildInsertQuery("orders", {}), /하나 이상의 필드가 필요합니다/);
});

test("buildDeleteQuery는 WHERE 조건이 필수이다", () => {
  const result = buildDeleteQuery("orders", [{ column: "id", operator: "eq", value: 123 }]);
  assert.equal(result.sql, "DELETE FROM `orders` WHERE `id` = ?");
  assert.deepEqual(result.values, [123]);
});

test("buildDeleteQuery는 WHERE 조건이 비어있으면 거부한다", () => {
  assert.throws(() => buildDeleteQuery("orders", []), /최소 하나 이상의 where 조건이 반드시 필요합니다/);
});
