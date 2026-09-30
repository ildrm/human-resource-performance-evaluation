import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";
import { TrendService } from "./trend.service.js";

@ApiTags("Longitudinal reporting")
@UseGuards(SessionGuard)
@Controller("v1")
export class TrendController {
  constructor(private readonly service: TrendService) {}

  @Get("people/:id/trends")
  forEmployee(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.service.forEmployee(request.principal, id);
  }
}
