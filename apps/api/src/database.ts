import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CONFIG, type Config } from './config';
@Injectable()
export class Database implements OnModuleDestroy {
  readonly client?: PrismaClient;
  constructor(@Inject(CONFIG) config: Config) {
    if (config.DATABASE_URL) this.client = new PrismaClient({datasources:{db:{url:config.DATABASE_URL}}});
  }
  async ready(): Promise<boolean> {
    if (!this.client) return false;
    // Bounded query; also fails if this database has not been migrated.
    await this.client.$queryRaw`SELECT id FROM maintenance."Organization" LIMIT 1`;
    return true;
  }
  async onModuleDestroy() { await this.client?.$disconnect(); }
}
