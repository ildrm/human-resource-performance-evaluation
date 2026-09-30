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
import { ContextService } from "./context.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Performance context")
@UseGuards(SessionGuard)
@Controller("v1")
export class ContextController {
  constructor(private readonly service: ContextService) {}

  @Get("people/:id/context-cycles")
  cycles(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.cycles(request.principal, id);
  }

  @Get("people/:id/context")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.list(request.principal, id);
  }

  @Get("context/:id")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.detail(request.principal, id);
  }

  @Post("context")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.create(request.principal, body);
  }

  @Post("context/:id/review")
  review(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.review(request.principal, id, body);
  }
}
