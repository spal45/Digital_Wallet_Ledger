import { ApiProperty } from '@nestjs/swagger';
import { TransferResponseDto } from './transfer-response.dto';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

export class TransferListResponseDto {
  @ApiProperty({ type: [TransferResponseDto] })
  data!: TransferResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
