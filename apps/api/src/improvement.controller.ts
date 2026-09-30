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
import { ImprovementService } from "./improvement.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Performance improvement plans")
@UseGuards(SessionGuard)
@Controller("v1")
export class ImprovementController {
  constructor(private readonly service: ImprovementService) {}

  @Get("people/:id/improvement-plans")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.list(request.principal, id);
  }

  @Get("improvement-plans/:id")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.detail(request.principal, id);
  }

  @Post("improvement-plans")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.create(request.principal, body);
  }

  @Post("improvement-plans/:id/events")
  record(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.record(request.principal, id, body);
  }
}
