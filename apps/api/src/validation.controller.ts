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
import { SessionGuard, type AuthenticatedRequest } from "./security.js";
import { ValidationService } from "./validation.service.js";

@ApiTags("Model evidence governance")
@UseGuards(SessionGuard)
@Controller("v1/validation")
export class ValidationController {
  constructor(private readonly service: ValidationService) {}

  @Get("dossiers")
  list(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.list(request.principal);
  }

  @Post("dossiers")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.create(request.principal, body);
  }

  @Post("dossiers/:id/review")
  review(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.review(request.principal, id, body);
  }

  @Post("dossiers/:id/retire")
  retire(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.retire(request.principal, id, body);
  }
}
