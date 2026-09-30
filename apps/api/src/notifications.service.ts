import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Database } from "./db.js";
import type { Principal } from "./security.js";

@Injectable()
export class NotificationsService {
  constructor(private readonly db: Database) {}

  async list(p: Principal, limit = 50): Promise<unknown> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException(
        "Notification limit must be between 1 and 100",
      );
    return this.db.tenant(p.tenantId, async (client) => {
      const result = await client.query(
        "SELECT id,kind,resource_id,created_at,read_at FROM notifications WHERE tenant_id=$1 AND recipient_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3",
        [p.tenantId, p.userId, limit],
      );
      return result.rows;
    });
  }

  async markRead(p: Principal, id: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const result = await client.query(
        "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE tenant_id=$1 AND id=$2 AND recipient_id=$3 RETURNING id,read_at",
        [p.tenantId, id, p.userId],
      );
      if (!result.rows[0])
        throw new NotFoundException("Notification not found");
      return result.rows[0];
    });
  }
}
