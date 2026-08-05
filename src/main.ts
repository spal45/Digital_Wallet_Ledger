import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Application } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Railway (and most PaaS hosts) terminate the real client connection at
  // their own edge proxy and forward to this container - without this,
  // Express's req.ip reflects that proxy hop, not the real client, which
  // breaks per-IP rate limiting (ThrottlerGuard reads req.ip).
  (app.getHttpAdapter().getInstance() as Application).set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Digital Wallet Ledger API')
    .setDescription(
      'A double-entry ledger for moving money between wallets, with idempotent transfers and JWT-based auth.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((error: unknown) => {
  console.error('Failed to start application', error);
  process.exit(1);
});
