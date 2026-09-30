import {
  Body,
  Controller,
  Get,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { loginInput } from "@hpi/contracts";
import type { Request, Response } from "express";
import { Database } from "./db.js";
import {
  clearLoginFailures,
  cleanupLoginFailures,
  loginAttemptKey,
  loginBlocked,
  recordLoginFailure,
} from "./auth-throttle.js";
import {
  newSessionToken,
  parseSessionToken,
  readSessionCookie,
  sessionCookie,
  SessionGuard,
  verifyPassword,
  type AuthenticatedRequest,
} from "./security.js";

@Injectable()
@ApiTags("Identity")
@Controller("v1/auth")
export class AuthController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthController.name);
  private cleanupTimer?: NodeJS.Timeout;
  constructor(private readonly db: Database) {}

  onModuleInit(): void {
    const cleanup = () =>
      void this.db
        .preAuth((client) => cleanupLoginFailures(client))
        .catch(() => this.logger.warn("Login counter cleanup failed"));
    cleanup();
    this.cleanupTimer = setInterval(cleanup, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  @Post("login")
  @ApiOperation({ summary: "Create a tenant-scoped session" })
  async login(
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = loginInput.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException("Invalid credentials");
    const key = loginAttemptKey(
      parsed.data.tenant,
      parsed.data.email,
      process.env.DATABASE_URL!,
    );
    if (await this.db.preAuth((client) => loginBlocked(client, key)))
      throw new HttpException("Try again later", 429);
    const tenantId = await this.db.tenantBySlug(parsed.data.tenant);
    const user = tenantId
      ? await this.db.tenant(tenantId, async (client) => {
          const result = await client.query<{
            id: string;
            password_hash: string;
            role:
              | "TENANT_ADMIN"
              | "HR_ADMIN"
              | "MANAGER"
              | "EMPLOYEE"
              | "CALIBRATOR"
              | "AUDITOR";
            name: string;
          }>(
            "SELECT id,password_hash,role,name FROM users WHERE tenant_id=$1 AND lower(email)=lower($2) AND active=true",
            [tenantId, parsed.data.email],
          );
          return result.rows[0];
        })
      : undefined;
    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      await this.db.preAuth((client) => recordLoginFailure(client, key));
      throw new UnauthorizedException("Invalid credentials");
    }
    await this.db.preAuth((client) => clearLoginFailures(client, key));
    const token = newSessionToken(tenantId!);
    const parsedToken = parseSessionToken(token)!;
    await this.db.tenant(tenantId!, (client) =>
      client.query(
        "INSERT INTO sessions(tenant_id,token_hash,user_id,expires_at) VALUES ($1,$2,$3,now() + interval '8 hours')",
        [tenantId, parsedToken.tokenHash, user.id],
      ),
    );
    sessionCookie(token, response);
    return { id: user.id, name: user.name, role: user.role };
  }

  @Post("logout")
  @ApiOperation({ summary: "Revoke this browser session" })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true }> {
    const token = readSessionCookie(request);
    const parsed = token ? parseSessionToken(token) : null;
    if (parsed)
      await this.db.tenant(parsed.tenantId, (client) =>
        client.query(
          "UPDATE sessions SET revoked_at=now() WHERE tenant_id=$1 AND token_hash=$2 AND revoked_at IS NULL",
          [parsed.tenantId, parsed.tokenHash],
        ),
      );
    response.clearCookie("hpi_session", { path: "/" });
    return { ok: true };
  }

  @UseGuards(SessionGuard)
  @Post("logout-all")
  @ApiOperation({ summary: "Revoke all sessions for the signed-in user" })
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true }> {
    await this.db.tenant(request.principal.tenantId, (client) =>
      client.query(
        "UPDATE sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL",
        [request.principal.tenantId, request.principal.userId],
      ),
    );
    response.clearCookie("hpi_session", { path: "/" });
    return { ok: true };
  }

  @UseGuards(SessionGuard)
  @Get("me")
  me(@Req() request: AuthenticatedRequest): unknown {
    return request.principal;
  }
}
