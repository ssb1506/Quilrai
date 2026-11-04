
import Database from "better-sqlite3";
import * as fs from "node:fs";
import { createHash } from "node:crypto";

export class TokenRateLimiter {
  private db: Database.Database;
  private insert: Database.Statement;
  private sum: Database.Statement;
  private prune: Database.Statement;
  private usageEvents: Database.Statement;

  constructor(
    path = "./data/usage.sqlite",
    private limit = 50_000,
    private windowMs = 60_000
  ) {
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs <= 0
    ) {
      throw new Error("Limit and window must be positive safe integers");
    }

    if (path !== ":memory:") {
      const directory =
        path.substring(0, Math.max(0, path.lastIndexOf("/"))) || ".";
      fs.mkdirSync(directory, { recursive: true });
    }

    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_key TEXT NOT NULL,
        tokens INTEGER NOT NULL CHECK(tokens >= 0),
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_tenant_time
      ON token_usage(tenant_key, created_at);
    `);

    this.insert = this.db.prepare(`
      INSERT INTO token_usage (tenant_key, tokens, created_at)
      VALUES (?, ?, ?)
    `);

    this.sum = this.db.prepare(`
      SELECT COALESCE(SUM(tokens), 0) AS total
      FROM token_usage
      WHERE tenant_key = ? AND created_at > ?
    `);

    this.prune = this.db.prepare(`
      DELETE FROM token_usage WHERE created_at <= ?
    `);

    this.usageEvents = this.db.prepare(`
      SELECT created_at, SUM(tokens) AS tokens
      FROM token_usage
      WHERE tenant_key = ? AND created_at > ?
      GROUP BY created_at
      ORDER BY created_at ASC
    `);
  }

  consume(
    tenantKey: string,
    tokens: number,
    now = Date.now()
  ): {
    allowed: boolean;
    used: number;
    limit: number;
    retryAfterMs?: number;
  } {
    if (
      typeof tenantKey !== "string" ||
      !tenantKey.trim() ||
      !Number.isSafeInteger(tokens) ||
      tokens < 0 ||
      !Number.isSafeInteger(now)
    ) {
      throw new Error(
        "A valid tenant key, non-negative integer token count, and timestamp are required"
      );
    }

    const tenantHash = createHash("sha256")
      .update(tenantKey)
      .digest("hex");

    return this.db.transaction(() => {
      const cutoff = now - this.windowMs;

      this.prune.run(cutoff);

      const used = Number(
        (this.sum.get(tenantHash, cutoff) as { total: number }).total
      );

      if (tokens > this.limit || used + tokens > this.limit) {
        let remaining = used;
        let retryAfterMs: number | undefined;

        if (tokens <= this.limit) {
          const events = this.usageEvents.all(tenantHash, cutoff) as {
            created_at: number;
            tokens: number;
          }[];

          for (const event of events) {
            remaining -= Number(event.tokens);

            if (remaining + tokens <= this.limit) {
              retryAfterMs = Math.max(
                0,
                event.created_at + this.windowMs - now
              );
              break;
            }
          }
        }

        return {
          allowed: false,
          used,
          limit: this.limit,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {})
        };
      }

      this.insert.run(tenantHash, tokens, now);

      return {
        allowed: true,
        used: used + tokens,
        limit: this.limit
      };
    }).immediate();
  }

  close(): void {
    this.db.close();
  }
}
