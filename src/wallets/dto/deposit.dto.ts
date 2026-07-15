import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class DepositDto {
  @ApiProperty({
    example: 1000,
    description:
      'Amount in minor units (e.g. paise), must be a positive integer',
  })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ example: 'Initial top-up' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'deposit-key-1',
    description:
      'Client-generated key. Retrying with the same key returns the original deposit instead of crediting twice.',
  })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
