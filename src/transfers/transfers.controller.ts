import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('transfers')
@Controller('transfers')
export class TransfersController {}
