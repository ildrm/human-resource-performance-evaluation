import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Readable } from "node:stream";
import {
  SessionGuard,
  requireRole,
  type AuthenticatedRequest,
} from "./security.js";
import { WorkspaceService } from "./workspace.service.js";

@ApiTags("Performance workspace")
@UseGuards(SessionGuard)
@Controller("v1")
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Get("overview")
  overview(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.overview(request.principal);
  }
  @Get("catalog")
  catalog(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.catalog(request.principal);
  }
  @Post("people")
  createPerson(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createPerson(request.principal, body);
  }
  @Post("jobs")
  createJob(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createJob(request.principal, body);
  }
  @Post("metrics")
  createMetric(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createMetric(request.principal, body);
  }
  @Post("templates")
  createTemplate(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createTemplate(request.principal, body);
  }
  @Post("templates/:id/activate")
  activateTemplate(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.activateTemplate(request.principal, id);
  }
  @Post("templates/:id/review")
  reviewTemplate(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.reviewTemplate(request.principal, id);
  }
  @Post("templates/:id/validate")
  validateTemplate(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.validateTemplate(request.principal, id, body);
  }
  @Post("templates/:id/approve")
  approveTemplate(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.approveTemplate(request.principal, id);
  }
  @Post("templates/:id/retire")
  retireTemplate(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.retireTemplate(request.principal, id, body);
  }
  @Post("targets")
  createTarget(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createTarget(request.principal, body);
  }
  @Post("cycles")
  createCycle(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createCycle(request.principal, body);
  }
  @Post("evidence")
  addEvidence(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.addEvidence(request.principal, body);
  }
  @Get("people/:id/evidence")
  evidenceFor(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.evidenceFor(request.principal, id);
  }
  @Post("evidence/:id/verify")
  verifyEvidence(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.verifyEvidence(request.principal, id, true);
  }
  @Post("evidence/:id/reject")
  rejectEvidence(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.verifyEvidence(request.principal, id, false);
  }
  @Post("people/:employeeId/cycles/:cycleId/calculate")
  @ApiOperation({
    summary:
      "Create a reproducible evaluation from approved template and verified evidence",
  })
  calculate(
    @Req() request: AuthenticatedRequest,
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Param("cycleId", ParseUUIDPipe) cycleId: string,
  ): Promise<unknown> {
    return this.service.calculateEvaluation(
      request.principal,
      employeeId,
      cycleId,
    );
  }
  @Get("evaluations/:id")
  evaluation(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.evaluation(request.principal, id);
  }
  @Get("evaluations/:id/replay")
  replay(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.replay(request.principal, id);
  }
  @Post("evaluations/:id/submit")
  submit(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.submit(request.principal, id, body);
  }
  @Post("evaluations/:id/calibrate")
  calibrate(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.calibrate(request.principal, id, body);
  }
  @Post("evaluations/:id/publish")
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.publish(request.principal, id);
  }
  @Post("evaluations/:id/acknowledge")
  acknowledge(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.acknowledge(request.principal, id);
  }
  @Post("evaluations/:id/appeal")
  appeal(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.appeal(request.principal, id, body);
  }
  @Post("appeals/:id/resolve")
  resolveAppeal(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.resolveAppeal(request.principal, id, body);
  }
  @Get("reports/evaluations")
  report(
    @Req() request: AuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.service.report(request.principal, {
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }
  @Get("audit/integrity")
  @ApiOperation({
    summary: "Verify the tenant audit chain and report legacy coverage",
  })
  auditIntegrity(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.auditIntegrity(request.principal);
  }
  @Get("reports/evaluations.csv")
  exportReport(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): void {
    requireRole(
      request.principal,
      "TENANT_ADMIN",
      "HR_ADMIN",
      "MANAGER",
      "CALIBRATOR",
      "AUDITOR",
    );
    response.type("text/csv; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="evaluations.csv"',
    );
    const stream = Readable.from(
      this.service.exportReportChunks(request.principal),
    );
    stream.on("error", () => {
      if (!response.headersSent) response.status(500).end();
      else response.destroy();
    });
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  }
}
