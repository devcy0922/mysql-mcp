import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditIdentity } from "./auth/authorization.js";

export interface AuditEvent {
  domain: string;
  operation: "list_domains" | "list_tables" | "describe_table" | "select" | "insert" | "delete";
  table?: string;
  requestedLimit?: number;
  resultCount?: number;
  outcome: "success" | "denied" | "error";
  identity?: AuditIdentity;
}

export class AuditLogger {
  public constructor(private readonly path: string) {}

  public async write(event: AuditEvent): Promise<void> {
    const { identity, ...details } = event;
    const record = { timestamp: new Date().toISOString(), ...identity, ...details };
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
