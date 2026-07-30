import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class CreateWebhookDto {
  @ApiProperty({
    example: 'https://example.com/webhooks/wallet-ledger',
    description:
      'URL to receive a POST request whenever a transfer involving your wallets completes',
  })
  @IsUrl({ require_tld: false })
  url!: string;
}
