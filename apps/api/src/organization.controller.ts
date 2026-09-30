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
import { OrganizationService } from "./organization.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Organization history")
@UseGuards(SessionGuard)
@Controller("v1")
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  @Get("organization/units")
  units(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.units(request.principal);
  }

  @Post("organization/units")
  createUnit(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createUnit(request.principal, body);
  }

  @Get("people/:id/organization")
  history(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.history(request.principal, id);
  }

  @Post("organization/assignments")
  assign(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.assign(request.principal, body);
  }

  @Post("organization/assignments/:id/end")
  end(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.endAssignment(request.principal, id, body);
  }
}
