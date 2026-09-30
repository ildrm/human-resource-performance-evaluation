import { Controller, Get, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PrivacyService } from "./privacy.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Privacy")
@UseGuards(SessionGuard)
@Controller("v1/privacy")
export class PrivacyController {
  constructor(private readonly service: PrivacyService) {}

  @Get("me/export")
  async exportMine(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    response.type("application/json; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="my-performance-data.json"',
    );
    return this.service.exportMine(request.principal);
  }
}
