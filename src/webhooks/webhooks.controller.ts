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
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { WebhookResponseDto } from './dto/webhook-response.dto';
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
  @ApiResponse({
    status: 200,
    description: 'List of webhooks',
    type: [WebhookResponseDto],
  })
  findAll(@CurrentUser() user: CurrentUserResponseDto) {
    return this.webhooksService.findAllForUser(user.userId);
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
