import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { DomainConfig } from "../config.js";

export interface AuditIdentity {
  authMode: "oidc";
  subject: string;
  username: string;
  clientId: string;
}

export class AuthorizationDeniedError extends Error {}

export function hasRequiredScopes(scopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => scopes.includes(scope));
}

export function assertScopes(authInfo: AuthInfo | undefined, requiredScopes: string[], authRequired: boolean): void {
  if (!authRequired) return;
  if (!authInfo) throw new AuthorizationDeniedError("인증 정보가 없습니다.");
  if (!hasRequiredScopes(authInfo.scopes, requiredScopes)) {
    throw new AuthorizationDeniedError("요청한 MCP 기능을 사용할 권한이 없습니다.");
  }
}

export function canAccessDomain(authInfo: AuthInfo | undefined, domain: DomainConfig, authRequired: boolean): boolean {
  if (!authRequired) return true;
  return authInfo !== undefined && hasRequiredScopes(authInfo.scopes, domain.requiredScopes);
}

export function auditIdentity(authInfo: AuthInfo | undefined): AuditIdentity | undefined {
  if (!authInfo) return undefined;
  const subject = authInfo.extra?.subject;
  const username = authInfo.extra?.username;
  if (typeof subject !== "string" || typeof username !== "string") return undefined;
  return { authMode: "oidc", subject, username, clientId: authInfo.clientId };
}
