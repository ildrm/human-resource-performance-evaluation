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
import { GoalsService } from "./goals.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Goals and check-ins")
@UseGuards(SessionGuard)
@Controller("v1")
export class GoalsController {
  constructor(private readonly service: GoalsService) {}

  @Get("people/:id/goals")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.list(request.principal, id);
  }

  @Get("goals/:id")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.detail(request.principal, id);
  }

  @Post("goals")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.create(request.principal, body);
  }

  @Post("goals/:id/revisions")
  revise(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.revise(request.principal, id, body);
  }

  @Post("goals/:id/check-ins")
  checkin(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.checkin(request.principal, id, body);
  }
}
