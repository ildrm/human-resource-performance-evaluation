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
import { DiscussionService } from "./discussion.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Review discussion")
@UseGuards(SessionGuard)
@Controller("v1/evaluations/:id/messages")
export class DiscussionController {
  constructor(private readonly service: DiscussionService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.list(request.principal, id);
  }

  @Post()
  post(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.post(request.principal, id, body);
  }
}
