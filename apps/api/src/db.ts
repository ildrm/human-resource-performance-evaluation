import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type SqlClient = Pick<PoolClient, "query">;

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;
  private rowSecurityChecked = false;

  constructor() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 15000,
    });
  }

  async onModuleInit(): Promise<void> {
    const tables = await this.pool.query<{
      relname: string;
      rls_active: boolean;
    }>(
      `SELECT c.relname,row_security_active(c.oid) AS rls_active
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p')
         AND EXISTS (
           SELECT 1 FROM pg_attribute a
           WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped
         )`,
    );
    const bypassed = tables.rows
      .filter((table) => !table.rls_active)
      .map((table) => table.relname);
    if (tables.rows.length === 0 || bypassed.length > 0)
      throw new Error(
        `Application database role must enforce row security on every tenant table; bypassed: ${bypassed.join(", ") || "none found"}`,
      );
    this.rowSecurityChecked = true;
  }

  async tenant<T>(
    tenantId: string,
    fn: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async tenantBySlug(slug: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM tenants WHERE slug = $1",
      [slug],
    );
    return result.rows[0]?.id ?? null;
  }

  async preAuth<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
    return fn(this.pool);
  }

  async ready(): Promise<boolean> {
    const result = await this.pool.query<QueryResultRow>("SELECT 1");
    return this.rowSecurityChecked && result.rowCount === 1;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
