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
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';

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
  @ApiResponse({
    status: 200,
    description: 'List of wallets',
    type: [WalletResponseDto],
  })
  findAll(@CurrentUser() user: CurrentUserResponseDto) {
    return this.walletsService.findAllForUser(user.userId);
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
}
