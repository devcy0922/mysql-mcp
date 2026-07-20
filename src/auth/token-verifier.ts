import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { OidcConfig } from "../config.js";

function claimAsString(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseScopes(payload: JWTPayload): string[] {
  const scope = claimAsString(payload, "scope") ?? "";
  return [...new Set(scope.split(/\s+/).map((value) => value.trim()).filter(Boolean))];
}

export class OidcTokenVerifier implements OAuthTokenVerifier {
  private readonly jwks;

  public constructor(private readonly config: OidcConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }

  public async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ["RS256"],
      });
      if (!payload.sub) throw new InvalidTokenError("Access token subject가 없습니다.");

      const clientId = claimAsString(payload, "azp") ?? claimAsString(payload, "client_id");
      if (!clientId) throw new InvalidTokenError("Access token client 식별자가 없습니다.");
      return {
        token,
        clientId,
        scopes: parseScopes(payload),
        expiresAt: payload.exp,
        extra: {
          subject: payload.sub,
          username: claimAsString(payload, this.config.usernameClaim) ?? payload.sub,
          issuer: payload.iss,
        },
      };
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      throw new InvalidTokenError("Access token 검증에 실패했습니다.");
    }
  }
}
