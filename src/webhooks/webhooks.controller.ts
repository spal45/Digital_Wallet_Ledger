import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {}
