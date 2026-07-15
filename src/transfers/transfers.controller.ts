import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CurrentUserResponseDto } from '../auth/dto/current-user-response.dto';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';

@ApiTags('transfers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @ApiOperation({
    summary:
      'Transfer funds between two wallets (idempotent, atomic double-entry)',
  })
  @ApiResponse({
    status: 201,
    description: 'Transfer completed',
    type: TransferResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Same wallet, or mismatched currencies',
  })
  @ApiResponse({ status: 403, description: "Not the source wallet's owner" })
  @ApiResponse({
    status: 404,
    description: 'A wallet in the transfer does not exist',
  })
  @ApiResponse({ status: 422, description: 'Insufficient balance' })
  create(
    @CurrentUser() user: CurrentUserResponseDto,
    @Body() dto: CreateTransferDto,
  ) {
    return this.transfersService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: "List transfers involving the current user's wallets",
  })
  @ApiResponse({
    status: 200,
    description: 'List of transfers',
    type: [TransferResponseDto],
  })
  findAll(@CurrentUser() user: CurrentUserResponseDto) {
    return this.transfersService.findAllForUser(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single transfer by id' })
  @ApiResponse({
    status: 200,
    description: 'Transfer detail',
    type: TransferResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Not a participant in this transfer',
  })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserResponseDto,
  ) {
    return this.transfersService.findOne(id, user);
  }
}
