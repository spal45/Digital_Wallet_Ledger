import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateWalletDto {
  @ApiPropertyOptional({
    example: 'INR',
    description: 'ISO 4217 currency code. Defaults to INR if omitted.',
    default: 'INR',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
