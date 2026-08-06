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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CurrentUserResponseDto } from '../auth/dto/current-user-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletListResponseDto } from './dto/wallet-list-response.dto';
import { DepositDto } from './dto/deposit.dto';
import { DepositResponseDto } from './dto/deposit-response.dto';

@ApiTags('wallets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a wallet for the current user' })
  @ApiResponse({
    status: 201,
    description: 'Wallet created',
    type: WalletResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'A wallet in this currency already exists',
  })
  create(
    @CurrentUser() user: CurrentUserResponseDto,
    @Body() dto: CreateWalletDto,
  ) {
    return this.walletsService.create(user.userId, dto.currency ?? 'INR');
  }

  @Get()
  @ApiOperation({
    summary: "List the current user's wallets, with computed balances",
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of wallets',
    type: WalletListResponseDto,
  })
  findAll(
    @CurrentUser() user: CurrentUserResponseDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.walletsService.findAllForUser(
      user.userId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single wallet by id, with computed balance' })
  @ApiResponse({
    status: 200,
    description: 'Wallet detail',
    type: WalletResponseDto,
  })
  @ApiResponse({ status: 403, description: "Not this user's wallet" })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserResponseDto,
  ) {
    return this.walletsService.findOne(id, user);
  }

  @Post(':id/deposit')
  @ApiOperation({ summary: 'Deposit funds into a wallet (idempotent)' })
  @ApiResponse({
    status: 201,
    description: 'Deposit completed',
    type: DepositResponseDto,
  })
  @ApiResponse({ status: 403, description: "Not this user's wallet" })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  deposit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserResponseDto,
    @Body() dto: DepositDto,
  ) {
    return this.walletsService.deposit(id, user, dto);
  }
}
