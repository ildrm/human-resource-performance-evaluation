import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./security.js";

@ApiTags("Notifications")
@UseGuards(SessionGuard)
@Controller("v1/notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.notifications.list(
      request.principal,
      limit === undefined ? 50 : Number(limit),
    );
  }

  @Post(":id/read")
  read(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.notifications.markRead(request.principal, id);
  }
}
