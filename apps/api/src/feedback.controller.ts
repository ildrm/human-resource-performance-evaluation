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
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { FeedbackService } from "./feedback.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Behavior and feedback")
@UseGuards(SessionGuard)
@Controller("v1/feedback")
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Post("scales")
  createScale(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createScale(request.principal, body);
  }

  @Post("scales/:id/activate")
  activateScale(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.activateScale(request.principal, id, body);
  }

  @Post("campaigns")
  createCampaign(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.createCampaign(request.principal, body);
  }

  @Get("assignments")
  assignments(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.assignments(request.principal);
  }

  @Get("catalog")
  catalog(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.service.catalog(request.principal);
  }

  @Post("campaigns/:id/ratings")
  @ApiOperation({
    summary: "Submit one anchored behavior rating as an invited respondent",
  })
  rate(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.service.rate(request.principal, id, body);
  }

  @Post("campaigns/:id/close")
  close(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.closeCampaign(request.principal, id);
  }

  @Get("campaigns/:id/summary")
  @ApiOperation({
    summary:
      "Release a closed feedback summary subject to respondent thresholds",
  })
  summary(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.summary(request.principal, id);
  }
}
