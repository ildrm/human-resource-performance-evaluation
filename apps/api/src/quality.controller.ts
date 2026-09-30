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
import { QualityService } from "./quality.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Evidence quality")
@UseGuards(SessionGuard)
@Controller("v1/evidence-quality")
export class QualityController {
  constructor(private readonly service: QualityService) {}

  @Get("policies")
  policies(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.policies(request.principal);
  }

  @Post("policies")
  createPolicy(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createPolicy(request.principal, body);
  }

  @Post("policies/:id/activate")
  activatePolicy(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.activatePolicy(request.principal, id, body);
  }
}
