import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';

export class TransferResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '9ad66d3d-847a-438c-9645-1e8921b91e83' })
  fromWalletId!: string;

  @ApiProperty({ example: '4cb11806-bd09-493a-b1e6-0febdc648cba' })
  toWalletId!: string;

  @ApiProperty({ example: 500 })
  amount!: number;

  @ApiProperty({ enum: TransferStatus, example: TransferStatus.COMPLETED })
  status!: TransferStatus;

  @ApiPropertyOptional({ example: 'Rent for July' })
  description?: string | null;

  @ApiProperty()
  createdAt!: Date;
}
