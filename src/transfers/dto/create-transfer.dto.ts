import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({
    example: '9ad66d3d-847a-438c-9645-1e8921b91e83',
    description: 'Source wallet id',
  })
  @IsUUID()
  fromWalletId!: string;

  @ApiProperty({
    example: '4cb11806-bd09-493a-b1e6-0febdc648cba',
    description: 'Destination wallet id',
  })
  @IsUUID()
  toWalletId!: string;

  @ApiProperty({
    example: 500,
    description:
      'Amount in minor units (e.g. paise), must be a positive integer',
  })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ example: 'Rent for July' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description:
      'Client-generated key. Retrying a request with the same key returns the original result instead of processing the transfer twice.',
  })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
