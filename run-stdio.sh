#!/bin/bash
# mysql-mcp stdio 실행 래퍼: 모든 MCP 클라이언트 공통 설정에서 이 스크립트를 command로 사용한다.
ROOT_DIR="$(dirname "$(readlink -f "$0")")"
set -a
source "$ROOT_DIR/.env"
set +a
export MYSQL_MCP_TRANSPORT=stdio
mkdir -p "$ROOT_DIR/var/logs"
export MYSQL_MCP_AUDIT_LOG_PATH="$ROOT_DIR/var/logs/mysql-mcp-audit.jsonl"
exec node "$ROOT_DIR/dist/src/index.js"
