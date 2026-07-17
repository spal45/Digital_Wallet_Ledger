import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const isLocalDatabase =
      connectionString?.includes('localhost') ||
      connectionString?.includes('127.0.0.1');

    super({
      adapter: new PrismaPg({
        connectionString,
        // Supabase's pooler presents a cert chain Node doesn't fully trust by
        // default; local Postgres doesn't support SSL at all, so only relax
        // verification for non-local connections.
        ...(isLocalDatabase ? {} : { ssl: { rejectUnauthorized: false } }),
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
