import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';

interface WebhookCreateArgs {
  data: { userId: string; url: string; secret: string };
}

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: {
    webhook: {
      create: jest.Mock<Promise<unknown>, [WebhookCreateArgs]>;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    prisma = {
      webhook: {
        create: jest.fn<Promise<unknown>, [WebhookCreateArgs]>(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  describe('create', () => {
    it('generates a secret and stores it alongside the webhook', async () => {
      prisma.webhook.create.mockResolvedValue({
        id: 'webhook-1',
        userId: 'user-1',
        url: 'https://example.com/hook',
        secret: 'irrelevant-because-mocked',
        isActive: true,
        createdAt: new Date(),
      });

      const result = await service.create('user-1', 'https://example.com/hook');

      const createArgs = prisma.webhook.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('user-1');
      expect(createArgs.data.url).toBe('https://example.com/hook');
      expect(createArgs.data.secret).toHaveLength(64); // 32 bytes, hex-encoded
      expect(result.secret).toBeDefined();
    });
  });

  describe('remove', () => {
    it('throws not found when the webhook does not exist', async () => {
      prisma.webhook.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws forbidden when removing someone else's webhook", async () => {
      prisma.webhook.findUnique.mockResolvedValue({
        id: 'webhook-1',
        userId: 'owner-id',
      });

      await expect(
        service.remove('webhook-1', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.webhook.delete).not.toHaveBeenCalled();
    });

    it('deletes the webhook when owned by the caller', async () => {
      prisma.webhook.findUnique.mockResolvedValue({
        id: 'webhook-1',
        userId: 'user-1',
      });

      await service.remove('webhook-1', 'user-1');

      expect(prisma.webhook.delete).toHaveBeenCalledWith({
        where: { id: 'webhook-1' },
      });
    });
  });

  describe('notifyTransferCompleted', () => {
    const payload = {
      transferId: 'transfer-1',
      fromWalletId: 'wallet-a',
      toWalletId: 'wallet-b',
      amount: 500,
      status: 'COMPLETED',
      createdAt: new Date(),
    };

    it('delivers a signed POST to every active webhook for the given users', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        {
          id: 'w1',
          userId: 'user-1',
          url: 'https://a.example.com/hook',
          secret: 'secret-a',
          isActive: true,
        },
        {
          id: 'w2',
          userId: 'user-2',
          url: 'https://b.example.com/hook',
          secret: 'secret-b',
          isActive: true,
        },
      ]);

      service.notifyTransferCompleted(['user-1', 'user-2'], payload);
      await new Promise((resolve) => process.nextTick(resolve)); // let the fire-and-forget dispatch run

      expect(prisma.webhook.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['user-1', 'user-2'] }, isActive: true },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://a.example.com/hook');
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Webhook-Signature']).toBeDefined();
      // JSON round-tripping turns payload.createdAt (a Date) into an ISO string.
      expect(JSON.parse(options.body as string)).toEqual({
        event: 'transfer.completed',
        data: { ...payload, createdAt: payload.createdAt.toISOString() },
      });
    });

    it('does not throw when a webhook delivery fails', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        {
          id: 'w1',
          userId: 'user-1',
          url: 'https://a.example.com/hook',
          secret: 'secret-a',
          isActive: true,
        },
      ]);
      fetchMock.mockRejectedValue(new Error('network error'));

      expect(() =>
        service.notifyTransferCompleted(['user-1'], payload),
      ).not.toThrow();
      await new Promise((resolve) => process.nextTick(resolve));
    });
  });
});
