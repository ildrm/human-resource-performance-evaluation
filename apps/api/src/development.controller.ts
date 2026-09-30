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
import { DevelopmentService } from "./development.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Development actions")
@UseGuards(SessionGuard)
@Controller("v1")
export class DevelopmentController {
  constructor(private readonly service: DevelopmentService) {}

  @Get("people/:id/development-actions")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.list(request.principal, id);
  }

  @Get("development-actions/:id")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.detail(request.principal, id);
  }

  @Post("development-actions")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.create(request.principal, body);
  }

  @Post("development-actions/:id/events")
  recordEvent(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.recordEvent(request.principal, id, body);
  }
}
