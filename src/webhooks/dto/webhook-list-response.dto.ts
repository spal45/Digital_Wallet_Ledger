import { ApiProperty } from '@nestjs/swagger';
import { WebhookResponseDto } from './webhook-response.dto';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

export class WebhookListResponseDto {
  @ApiProperty({ type: [WebhookResponseDto] })
  data!: WebhookResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
