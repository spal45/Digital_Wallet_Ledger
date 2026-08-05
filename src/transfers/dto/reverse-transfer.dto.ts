import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReverseTransferDto {
  @ApiPropertyOptional({
    example: 'Reversed per customer dispute #4821',
    description:
      'Optional reason, stored on the reversing transfer. Defaults to a generic message if omitted.',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
