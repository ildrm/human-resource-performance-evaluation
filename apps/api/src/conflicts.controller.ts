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
import { ConflictsService } from "./conflicts.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Review conflicts")
@UseGuards(SessionGuard)
@Controller("v1")
export class ConflictsController {
  constructor(private readonly service: ConflictsService) {}

  @Get("evaluations/:id/conflicts")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.list(request.principal, id);
  }
  @Post("evaluations/:id/conflicts")
  declare(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.declare(request.principal, id, body);
  }
  @Post("conflicts/:id/resolve")
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.resolve(request.principal, id, body);
  }
}
