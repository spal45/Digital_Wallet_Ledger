import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';

export class DepositResponseDto {
  @ApiProperty({
    description: 'Id of the transfer record created for this deposit',
  })
  transferId!: string;

  @ApiProperty()
  walletId!: string;

  @ApiProperty({ example: 1000 })
  amount!: number;

  @ApiProperty({ enum: TransferStatus, example: TransferStatus.COMPLETED })
  status!: TransferStatus;

  @ApiPropertyOptional({ example: 'Initial top-up' })
  description?: string | null;

  @ApiProperty()
  createdAt!: Date;
}
