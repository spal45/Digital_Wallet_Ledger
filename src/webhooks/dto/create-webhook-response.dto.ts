import { ApiProperty } from '@nestjs/swagger';
import { WebhookResponseDto } from './webhook-response.dto';

export class CreateWebhookResponseDto extends WebhookResponseDto {
  @ApiProperty({
    description:
      'Signing secret for this webhook, shown only once. Use it to verify the X-Webhook-Signature header on incoming deliveries.',
    example: 'a1b2c3d4e5f6...',
  })
  secret!: string;
}
