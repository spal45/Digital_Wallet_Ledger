import { ApiProperty } from '@nestjs/swagger';

export class WalletResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '09be5d60-d049-4b20-b1e0-d4fec5eb563b' })
  userId!: string;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({
    example: 1000,
    description:
      'Current balance in minor units (e.g. paise), computed from ledger entries',
  })
  balance!: number;

  @ApiProperty()
  createdAt!: Date;
}
