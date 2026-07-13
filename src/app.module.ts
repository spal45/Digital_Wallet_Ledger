import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransfersModule } from './transfers/transfers.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [AuthModule, WalletsModule, TransfersModule, WebhooksModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
