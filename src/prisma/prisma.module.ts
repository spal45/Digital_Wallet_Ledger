import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // This decorator makes the module available everywhere instantly
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // Export it so other services can inject it
})
export class PrismaModule {}
