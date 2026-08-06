import { ApiProperty } from '@nestjs/swagger';
import { WalletResponseDto } from './wallet-response.dto';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

export class WalletListResponseDto {
  @ApiProperty({ type: [WalletResponseDto] })
  data!: WalletResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
