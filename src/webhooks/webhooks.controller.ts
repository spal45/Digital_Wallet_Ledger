import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { WebhookListResponseDto } from './dto/webhook-list-response.dto';
import { CreateWebhookResponseDto } from './dto/create-webhook-response.dto';

@ApiTags('webhooks')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({
    summary:
      'Register a webhook, notified whenever a transfer involving your wallets completes',
  })
  @ApiResponse({
    status: 201,
    description:
      'Webhook registered; the signing secret is shown only in this response',
    type: CreateWebhookResponseDto,
  })
  create(
    @CurrentUser() user: CurrentUserResponseDto,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooksService.create(user.userId, dto.url);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's registered webhooks" })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of webhooks',
    type: WebhookListResponseDto,
  })
  findAll(
    @CurrentUser() user: CurrentUserResponseDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.webhooksService.findAllForUser(
      user.userId,
      pagination.page,
      pagination.limit,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a webhook' })
  @ApiResponse({ status: 204, description: 'Webhook removed' })
  @ApiResponse({ status: 403, description: "Not this user's webhook" })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserResponseDto,
  ) {
    return this.webhooksService.remove(id, user.userId);
  }
}
