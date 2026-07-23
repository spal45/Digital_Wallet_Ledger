import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Supabase's pooler presents a cert chain Node doesn't fully trust by
    // default; plain Postgres (local, or the Docker Compose service) doesn't
    // support SSL at all. Set DATABASE_SSL=true only for Supabase-pointed
    // environments (see .env) rather than guessing from the hostname.
    const useSsl = process.env.DATABASE_SSL === 'true';

    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
