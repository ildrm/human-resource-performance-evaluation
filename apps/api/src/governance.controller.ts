import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { GovernanceService } from "./governance.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Safety and compliance governance")
@UseGuards(SessionGuard)
@Controller("v1")
export class GovernanceController {
  constructor(private readonly service: GovernanceService) {}

  @Get("people/:id/governance-cases")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.list(request.principal, id);
  }

  @Get("governance-cases/:id")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.detail(request.principal, id);
  }

  @Post("governance-cases")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.create(request.principal, body);
  }

  @Post("governance-cases/:id/events")
  record(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.record(request.principal, id, body);
  }
}
