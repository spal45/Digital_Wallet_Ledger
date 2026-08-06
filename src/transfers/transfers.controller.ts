import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CurrentUserResponseDto } from '../auth/dto/current-user-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { TransferListResponseDto } from './dto/transfer-list-response.dto';
import { ReverseTransferDto } from './dto/reverse-transfer.dto';

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
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of transfers',
    type: TransferListResponseDto,
  })
  findAll(
    @CurrentUser() user: CurrentUserResponseDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.transfersService.findAllForUser(
      user.userId,
      pagination.page,
      pagination.limit,
    );
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

  @Post(':id/reverse')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPPORT)
  @ApiOperation({
    summary:
      'Reverse a completed transfer (ADMIN/SUPPORT only) by creating an opposite-direction transfer',
  })
  @ApiResponse({
    status: 201,
    description: 'Reversal transfer created; the original is marked REVERSED',
    type: TransferResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Transfer is not in a reversible state',
  })
  @ApiResponse({ status: 403, description: 'Caller is not ADMIN or SUPPORT' })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  @ApiResponse({
    status: 422,
    description:
      "Recipient's wallet no longer has sufficient balance to reverse",
  })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseTransferDto,
  ) {
    return this.transfersService.reverse(id, dto.description);
  }
}
