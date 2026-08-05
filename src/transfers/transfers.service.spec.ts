import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, TransferStatus, UserRole } from '@prisma/client';
import { TransfersService } from './transfers.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';

interface WalletRow {
  id: string;
  userId: string;
  currency: string;
}

interface TransferCreateArgs {
  data: {
    idempotencyKey: string;
    ledgerEntries: {
      create: { walletId: string; type: string; amount: number }[];
    };
  };
}

describe('TransfersService', () => {
  let service: TransfersService;
  let tx: {
    $queryRaw: jest.Mock;
    ledgerEntry: { aggregate: jest.Mock };
    transfer: {
      create: jest.Mock<Promise<unknown>, [TransferCreateArgs]>;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let prisma: {
    $transaction: jest.Mock;
    transfer: { findUnique: jest.Mock; findMany: jest.Mock };
  };
  let webhooksService: {
    notifyTransferCompleted: jest.Mock;
    notifyTransferReversed: jest.Mock;
  };

  const wallets: Record<string, WalletRow> = {
    'wallet-from': { id: 'wallet-from', userId: 'user-1', currency: 'INR' },
    'wallet-to': { id: 'wallet-to', userId: 'user-2', currency: 'INR' },
    'wallet-usd': { id: 'wallet-usd', userId: 'user-2', currency: 'USD' },
  };

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn(),
      ledgerEntry: { aggregate: jest.fn() },
      transfer: {
        create: jest.fn<Promise<unknown>, [TransferCreateArgs]>(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
      transfer: { findUnique: jest.fn(), findMany: jest.fn() },
    };
    webhooksService = {
      notifyTransferCompleted: jest.fn(),
      notifyTransferReversed: jest.fn(),
    };

    // $queryRaw is called once per wallet id, in sorted order; resolve using our fixture map.
    tx.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray, walletId: string) => {
        const wallet = wallets[walletId];
        return Promise.resolve(wallet ? [wallet] : []);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebhooksService, useValue: webhooksService },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
  });

  const baseDto = {
    fromWalletId: 'wallet-from',
    toWalletId: 'wallet-to',
    amount: 100,
    idempotencyKey: 'idem-key-1',
  };

  it('rejects a transfer to the same wallet', async () => {
    prisma.transfer.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        { userId: 'user-1', role: UserRole.CUSTOMER },
        { ...baseDto, toWalletId: 'wallet-from' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the existing transfer without reprocessing when the idempotency key was already used', async () => {
    const existing = {
      id: 'transfer-1',
      amount: 100,
      status: TransferStatus.COMPLETED,
      description: null,
      createdAt: new Date(),
      ledgerEntries: [
        { walletId: 'wallet-from', type: 'DEBIT' },
        { walletId: 'wallet-to', type: 'CREDIT' },
      ],
    };
    prisma.transfer.findUnique.mockResolvedValue(existing);

    const result = await service.create(
      { userId: 'user-1', role: UserRole.CUSTOMER },
      baseDto,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'transfer-1',
        fromWalletId: 'wallet-from',
        toWalletId: 'wallet-to',
      }),
    );
  });

  it('throws not found when a wallet does not exist', async () => {
    prisma.transfer.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        { userId: 'user-1', role: UserRole.CUSTOMER },
        { ...baseDto, toWalletId: 'missing-wallet' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws forbidden when the caller does not own the source wallet', async () => {
    prisma.transfer.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        { userId: 'someone-else', role: UserRole.CUSTOMER },
        baseDto,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects transfers between wallets with different currencies', async () => {
    prisma.transfer.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        { userId: 'user-1', role: UserRole.CUSTOMER },
        { ...baseDto, toWalletId: 'wallet-usd' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a transfer when the source wallet balance is insufficient', async () => {
    prisma.transfer.findUnique.mockResolvedValue(null);
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 50 } });

    await expect(
      service.create({ userId: 'user-1', role: UserRole.CUSTOMER }, baseDto),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.transfer.create).not.toHaveBeenCalled();
  });

  it('creates two balanced ledger entries for a valid transfer', async () => {
    prisma.transfer.findUnique.mockResolvedValue(null);
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 500 } });
    tx.transfer.create.mockResolvedValue({
      id: 'transfer-2',
      amount: 100,
      status: TransferStatus.COMPLETED,
      description: undefined,
      createdAt: new Date(),
      ledgerEntries: [
        { walletId: 'wallet-from', type: 'DEBIT', amount: -100 },
        { walletId: 'wallet-to', type: 'CREDIT', amount: 100 },
      ],
    });

    const result = await service.create(
      { userId: 'user-1', role: UserRole.CUSTOMER },
      baseDto,
    );

    const createArgs = tx.transfer.create.mock.calls[0][0];
    const entries = createArgs.data.ledgerEntries.create;
    expect(entries).toEqual([
      { walletId: 'wallet-from', type: 'DEBIT', amount: -100 },
      { walletId: 'wallet-to', type: 'CREDIT', amount: 100 },
    ]);
    expect(result.fromWalletId).toBe('wallet-from');
    expect(result.toWalletId).toBe('wallet-to');
    expect(webhooksService.notifyTransferCompleted).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      expect.objectContaining({ transferId: 'transfer-2', amount: 100 }),
    );
  });

  it('does not notify webhooks when the transfer is an idempotent replay', async () => {
    const existing = {
      id: 'transfer-1',
      amount: 100,
      status: TransferStatus.COMPLETED,
      description: null,
      createdAt: new Date(),
      ledgerEntries: [
        { walletId: 'wallet-from', type: 'DEBIT' },
        { walletId: 'wallet-to', type: 'CREDIT' },
      ],
    };
    prisma.transfer.findUnique.mockResolvedValue(existing);

    await service.create(
      { userId: 'user-1', role: UserRole.CUSTOMER },
      baseDto,
    );

    expect(webhooksService.notifyTransferCompleted).not.toHaveBeenCalled();
  });

  it('returns the winning transfer when a concurrent duplicate request races on the idempotency key', async () => {
    prisma.transfer.findUnique
      .mockResolvedValueOnce(null) // initial idempotency check finds nothing
      .mockResolvedValueOnce({
        id: 'transfer-winner',
        amount: 100,
        status: TransferStatus.COMPLETED,
        description: null,
        createdAt: new Date(),
        ledgerEntries: [
          { walletId: 'wallet-from', type: 'DEBIT' },
          { walletId: 'wallet-to', type: 'CREDIT' },
        ],
      });
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 500 } });
    tx.transfer.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.create(
      { userId: 'user-1', role: UserRole.CUSTOMER },
      baseDto,
    );

    expect(result.id).toBe('transfer-winner');
  });

  describe('reverse', () => {
    const completedOriginal = {
      id: 'transfer-1',
      amount: 100,
      status: TransferStatus.COMPLETED,
      ledgerEntries: [
        { walletId: 'wallet-from', type: 'DEBIT', amount: -100 },
        { walletId: 'wallet-to', type: 'CREDIT', amount: 100 },
      ],
    };

    it('returns the existing reversal without reprocessing when already reversed', async () => {
      const existingReversal = {
        id: 'reversal-1',
        amount: 100,
        status: TransferStatus.COMPLETED,
        description: null,
        createdAt: new Date(),
        ledgerEntries: [
          { walletId: 'wallet-to', type: 'DEBIT' },
          { walletId: 'wallet-from', type: 'CREDIT' },
        ],
      };
      prisma.transfer.findUnique.mockResolvedValue(existingReversal);

      const result = await service.reverse('transfer-1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.id).toBe('reversal-1');
    });

    it('throws not found when the original transfer does not exist', async () => {
      prisma.transfer.findUnique.mockResolvedValue(null); // no existing reversal
      tx.transfer.findUnique.mockResolvedValue(null); // no original transfer

      await expect(service.reverse('missing-transfer')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects reversing a transfer that is not COMPLETED', async () => {
      prisma.transfer.findUnique.mockResolvedValue(null);
      tx.transfer.findUnique.mockResolvedValue({
        ...completedOriginal,
        status: TransferStatus.REVERSED,
      });

      await expect(service.reverse('transfer-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects when the recipient's wallet no longer has sufficient balance", async () => {
      prisma.transfer.findUnique.mockResolvedValue(null);
      tx.transfer.findUnique.mockResolvedValue(completedOriginal);
      tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 50 } }); // wallet-to only has 50 left

      await expect(service.reverse('transfer-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(tx.transfer.create).not.toHaveBeenCalled();
    });

    it('creates an opposite-direction transfer and marks the original REVERSED', async () => {
      prisma.transfer.findUnique.mockResolvedValue(null);
      tx.transfer.findUnique.mockResolvedValue(completedOriginal);
      tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
      tx.transfer.create.mockResolvedValue({
        id: 'reversal-1',
        amount: 100,
        status: TransferStatus.COMPLETED,
        description: 'Reversal of transfer transfer-1',
        createdAt: new Date(),
        ledgerEntries: [
          { walletId: 'wallet-to', type: 'DEBIT', amount: -100 },
          { walletId: 'wallet-from', type: 'CREDIT', amount: 100 },
        ],
      });

      const result = await service.reverse('transfer-1');

      const createArgs = tx.transfer.create.mock.calls[0][0];
      expect(createArgs.data.idempotencyKey).toBe('reversal:transfer-1');
      expect(createArgs.data.ledgerEntries.create).toEqual([
        { walletId: 'wallet-to', type: 'DEBIT', amount: -100 },
        { walletId: 'wallet-from', type: 'CREDIT', amount: 100 },
      ]);
      expect(tx.transfer.update).toHaveBeenCalledWith({
        where: { id: 'transfer-1' },
        data: { status: TransferStatus.REVERSED },
      });
      expect(result.id).toBe('reversal-1');
      expect(result.fromWalletId).toBe('wallet-to');
      expect(result.toWalletId).toBe('wallet-from');
      expect(webhooksService.notifyTransferReversed).toHaveBeenCalledWith(
        ['user-2', 'user-1'],
        expect.objectContaining({
          transferId: 'reversal-1',
          reversedTransferId: 'transfer-1',
        }),
      );
    });

    it('returns the winning reversal when a concurrent duplicate request races', async () => {
      prisma.transfer.findUnique
        .mockResolvedValueOnce(null) // initial idempotency check finds nothing
        .mockResolvedValueOnce({
          id: 'reversal-winner',
          amount: 100,
          status: TransferStatus.COMPLETED,
          description: null,
          createdAt: new Date(),
          ledgerEntries: [
            { walletId: 'wallet-to', type: 'DEBIT' },
            { walletId: 'wallet-from', type: 'CREDIT' },
          ],
        });
      tx.transfer.findUnique.mockResolvedValue(completedOriginal);
      tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
      tx.transfer.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.reverse('transfer-1');

      expect(result.id).toBe('reversal-winner');
    });
  });
});
