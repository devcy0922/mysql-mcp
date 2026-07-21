# MySQL & MariaDB MCP Server (Safe Read-Only)

MySQL과 MariaDB를 MCP(Model Context Protocol) 도구로 **읽기 전용** 조회하는 독립 서비스입니다. 
AI 에이전트에게 데이터베이스 조회를 허용하면서도, 임의 SQL 실행으로 인한 위험을 방지하고 보안 규정을 준수할 수 있도록 설계되었습니다.

---

## ✨ 핵심 기능

1. **안전한 읽기 전용 (Safe Read-Only)**
   - AI 에이전트가 임의의 SQL(CREATE, UPDATE, DELETE 등)을 직접 실행할 수 없습니다.
   - 사전에 설정된 화이트리스트 테이블(`allowedTables`)만 조회할 수 있으며, 구조화된 JSON 조건(`mysql_select`)으로만 질의를 제한하여 SQL Injection을 원천 차단합니다.
2. **다중 데이터베이스 관리 (Multi-Domain)**
   - 하나의 MCP 서비스에서 여러 DB 연결 설정을 개별 도메인으로 분리하여 관리할 수 있습니다.
3. **엔터프라이즈 보안 및 OIDC 인증**
   - 로컬 CLI 환경에서는 `stdio` 프로토콜을 사용하고, 원격 공유 환경에서는 `Streamable HTTP`를 지원합니다.
   - HTTP 모드 구동 시 외부 OIDC Authorization Server(예: Keycloak 등)의 Access Token(JWT)을 필수적으로 검증하여 다중 테넌트 접근을 제어합니다.
4. **엄격한 쿼리 제어 및 감사 로그 (Audit Log)**
   - 대량 유출 방지를 위한 조회 제한(`LIMIT` 최대 1,000건 제한, 대용량 조회 시 조건 필수화)을 강제합니다.
   - 모든 데이터 접근 내역을 Trace ID와 함께 감사 로그(JSON Lines)로 남깁니다.

---

## 🛠️ 제공하는 MCP 도구 (Tools)

| 도구 이름 | 용도 | 입력 매개변수 |
|---|---|---|
| `mysql_list_domains` | 접근이 허용된 도메인 및 테이블 목록 확인 | 없음 |
| `mysql_list_tables` | 특정 도메인의 허용된 테이블 존재 여부 확인 | `domain` |
| `mysql_describe_table`| 지정 테이블의 스키마(컬럼, 데이터 형식, Key) 확인 | `domain`, `table` |
| `mysql_select` | 구조화된 쿼리 조건으로 데이터 읽기 조회 | `domain`, `table`, `columns` (선택), `where` (선택), `limit` (선택) |
| `mysql_insert` | (선택적) 허용된 테이블에 단일 레코드 데이터 삽입 | `domain`, `table`, `record` (객체) |
| `mysql_delete` | (선택적) 지정 조건에 부합하는 레코드 삭제 | `domain`, `table`, `where` (배열, **필수**) |

> **`mysql_select` 상세 설명:**
> `where` 배열의 각 조건은 `column`, `operator`(`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `isNull`, `isNotNull`), `value`를 받아 MySQL Prepared Statement 파라미터로 안전하게 바인딩됩니다.

---

## 🚀 빠른 시작 (Getting Started)

### 1. 환경 설정
프로젝트 루트에 `.env` 파일을 복사하여 생성하고 DB 연결 정보를 설정합니다.
```bash
cp .env.example .env
```

`.env` 설정 예시:
```dotenv
MYSQL_MCP_DOMAINS_JSON='{
  "domains": [
    {
      "domain": "orders",
      "engine": "mysql",
      "host": "mysql-host",
      "port": 3306,
      "database": "orders_db",
      "user": "readonly_user",
      "passwordEnv": "MYSQL_MCP_ORDERS_PASSWORD",
      "allowedTables": ["orders", "order_items"]
    }
  ]
}'
MYSQL_MCP_ORDERS_PASSWORD=your_secure_password
MYSQL_MCP_DEFAULT_LIMIT=100
MYSQL_MCP_MAX_LIMIT=1000
MYSQL_MCP_ENABLE_WRITE=true
MYSQL_MCP_OIDC_WRITE_SCOPE=mysql:write
```

### 2. 로컬 실행 (Node.js)

```bash
# 의존성 설치
npm install

# TypeScript 빌드
npm run build

# stdio 모드로 실행 (MCP Client에 연결 가능한 표준 입출력 모드)
npm run start
```

### 3. Docker로 실행

본 서비스를 독립 컨테이너 또는 마이크로서비스로 구동할 수 있습니다.

```bash
# Docker 이미지 빌드
docker build -t mysql-mcp .

# 컨테이너 실행
docker run --env-file .env -i mysql-mcp
```

---

## 🔒 운영 및 보안 고려사항

* **최소 권한 원칙:** DB 커넥션 계정은 대상 데이터베이스의 `SELECT`, `SHOW VIEW` 등 최소한의 필요한 권한만 가져야 합니다. 쓰기 기능을 활성화할 경우 해당 테이블의 `INSERT`, `DELETE` 권한을 추가로 부여하십시오.
* **쓰기/삭제 분기 및 제한:** `MYSQL_MCP_ENABLE_WRITE=true`일 때만 생성/삭제 툴이 AI 에이전트에 노출됩니다. 또한 대량 삭제 방지를 위해 `mysql_delete`는 `where` 필터 조건이 비어 있으면 실행을 거부합니다.
* **민감 정보 비노출:** 감사 로그는 JSON Lines 형식으로 생성되며, 보안 규정에 따라 비밀번호나 SQL 바인딩 값 원문, API Key는 로그에 기록되지 않습니다.
* **제한 조치:** `limit`을 누락하면 기본값(100)이 적용되며, 100건을 초과하는 대량 조회를 시도할 때는 최소 1개 이상의 `where` 필터 조건이 필수로 제공되어야 쿼리가 수락됩니다.
