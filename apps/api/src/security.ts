import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Role } from "@hpi/contracts";
import { Database } from "./db.js";

export type Principal = {
  tenantId: string;
  userId: string;
  role: Role;
  employeeId: string | null;
  exp: number;
};
export type AuthenticatedRequest = Request & { principal: Principal };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash || hash.length !== 128) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
}

export function newSessionToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString("base64url")}`;
}

export function parseSessionToken(
  token: string,
): { tenantId: string; tokenHash: string } | null {
  const [tenantId, random, extra] = token.split(".");
  if (
    extra !== undefined ||
    !tenantId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tenantId,
    ) ||
    !random ||
    !/^[A-Za-z0-9_-]{43}$/.test(random)
  )
    return null;
  return {
    tenantId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

export function readSessionCookie(request: Request): string | null {
  return (
    request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("hpi_session="))
      ?.slice("hpi_session=".length) ?? null
  );
}

export function sessionCookie(token: string, response: Response): void {
  const secure = process.env.PUBLIC_ORIGIN?.startsWith("https://") ?? false;
  response.cookie("hpi_session", token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  });
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionCookie(request);
    const parsed = token ? parseSessionToken(token) : null;
    if (!parsed) throw new UnauthorizedException("Authentication required");
    const current = await this.db.tenant(parsed.tenantId, async (client) => {
      const result = await client.query<{
        user_id: string;
        role: Role;
        expires_at: Date;
      }>(
        "SELECT s.user_id,u.role,s.expires_at FROM sessions s JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id WHERE s.tenant_id=$1 AND s.token_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active=true",
        [parsed.tenantId, parsed.tokenHash],
      );
      return result.rows[0];
    });
    if (!current)
      throw new UnauthorizedException("Session user no longer active");
    request.principal = {
      tenantId: parsed.tenantId,
      userId: current.user_id,
      role: current.role,
      employeeId: current.user_id,
      exp: new Date(current.expires_at).getTime(),
    };
    return true;
  }
}

export function requireRole(principal: Principal, ...allowed: Role[]): void {
  if (!allowed.includes(principal.role))
    throw new ForbiddenException("Insufficient permission");
}

export function canSeeEmployee(
  principal: Principal,
  employeeId: string,
  managerId: string | null,
): boolean {
  return (
    ["TENANT_ADMIN", "HR_ADMIN", "CALIBRATOR", "AUDITOR"].includes(
      principal.role,
    ) ||
    principal.employeeId === employeeId ||
    (principal.role === "MANAGER" && principal.employeeId === managerId)
  );
}
