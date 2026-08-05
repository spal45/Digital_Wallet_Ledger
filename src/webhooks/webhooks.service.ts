import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface TransferEventPayload {
  transferId: string;
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  status: string;
  createdAt: Date;
  reversedTransferId?: string;
}

type WebhookEvent = 'transfer.completed' | 'transfer.reversed';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, url: string) {
    const secret = randomBytes(32).toString('hex');
    const webhook = await this.prisma.webhook.create({
      data: { userId, url, secret },
    });
    return {
      id: webhook.id,
      url: webhook.url,
      isActive: webhook.isActive,
      createdAt: webhook.createdAt,
      secret,
    };
  }

  async findAllForUser(userId: string) {
    const webhooks = await this.prisma.webhook.findMany({ where: { userId } });
    return webhooks.map((webhook) => ({
      id: webhook.id,
      url: webhook.url,
      isActive: webhook.isActive,
      createdAt: webhook.createdAt,
    }));
  }

  async remove(id: string, userId: string) {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }
    if (webhook.userId !== userId) {
      throw new ForbiddenException('You do not have access to this webhook');
    }
    await this.prisma.webhook.delete({ where: { id } });
  }

  /**
   * Fire-and-forget: dispatches to every active webhook belonging to the
   * given users, without blocking the caller on delivery latency or letting
   * a delivery failure affect the transfer that triggered it.
   */
  notifyTransferCompleted(
    userIds: string[],
    payload: TransferEventPayload,
  ): void {
    this.dispatch('transfer.completed', userIds, payload).catch(
      (error: unknown) => {
        this.logger.warn(
          `Unexpected error dispatching webhooks: ${String(error)}`,
        );
      },
    );
  }

  /**
   * Same fire-and-forget contract as notifyTransferCompleted, for the
   * reversing transfer created by TransfersService.reverse().
   */
  notifyTransferReversed(
    userIds: string[],
    payload: TransferEventPayload,
  ): void {
    this.dispatch('transfer.reversed', userIds, payload).catch(
      (error: unknown) => {
        this.logger.warn(
          `Unexpected error dispatching webhooks: ${String(error)}`,
        );
      },
    );
  }

  private async dispatch(
    event: WebhookEvent,
    userIds: string[],
    payload: TransferEventPayload,
  ) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { userId: { in: userIds }, isActive: true },
    });

    await Promise.allSettled(
      webhooks.map((webhook) =>
        this.deliver(event, webhook.url, webhook.secret, payload),
      ),
    );
  }

  private async deliver(
    event: WebhookEvent,
    url: string,
    secret: string,
    payload: TransferEventPayload,
  ) {
    const body = JSON.stringify({ event, data: payload });
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.warn(
          `Webhook delivery to ${url} returned status ${response.status}`,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(`Webhook delivery to ${url} failed: ${String(error)}`);
    }
  }
}
