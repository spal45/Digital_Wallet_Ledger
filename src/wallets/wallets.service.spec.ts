import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';

interface TransferCreateArgs {
  data: {
    ledgerEntries: {
      create: { walletId: string; type: string; amount: number }[];
    };
  };
}

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: {
    wallet: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    ledgerEntry: { groupBy: jest.Mock; aggregate: jest.Mock };
    transfer: {
      findUnique: jest.Mock;
      create: jest.Mock<Promise<unknown>, [TransferCreateArgs]>;
    };
  };

  beforeEach(async () => {
    prisma = {
      wallet: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      ledgerEntry: {
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      transfer: {
        findUnique: jest.fn(),
        create: jest.fn<Promise<unknown>, [TransferCreateArgs]>(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  describe('create', () => {
    it('creates a wallet with a zero starting balance', async () => {
      prisma.wallet.create.mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        currency: 'INR',
        createdAt: new Date(),
      });

      const result = await service.create('user-1', 'INR');

      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', currency: 'INR' },
      });
      expect(result.balance).toBe(0);
    });

    it('throws a conflict when a wallet in that currency already exists', async () => {
      prisma.wallet.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.create('user-1', 'INR')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findAllForUser', () => {
    it('returns an empty array without querying ledger entries when there are no wallets', async () => {
      prisma.wallet.findMany.mockResolvedValue([]);

      const result = await service.findAllForUser('user-1');

      expect(result).toEqual([]);
      expect(prisma.ledgerEntry.groupBy).not.toHaveBeenCalled();
    });

    it('attaches computed balances to each wallet', async () => {
      prisma.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-1',
          userId: 'user-1',
          currency: 'INR',
          createdAt: new Date(),
        },
        {
          id: 'wallet-2',
          userId: 'user-1',
          currency: 'USD',
          createdAt: new Date(),
        },
      ]);
      prisma.ledgerEntry.groupBy.mockResolvedValue([
        { walletId: 'wallet-1', _sum: { amount: 500 } },
        // wallet-2 has no ledger entries at all
      ]);

      const result = await service.findAllForUser('user-1');

      expect(result).toEqual([
        expect.objectContaining({ id: 'wallet-1', balance: 500 }),
        expect.objectContaining({ id: 'wallet-2', balance: 0 }),
      ]);
    });
  });

  describe('findOne', () => {
    it('throws not found when the wallet does not exist', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('missing-wallet', {
          userId: 'user-1',
          role: UserRole.CUSTOMER,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws forbidden when a customer requests someone else's wallet", async () => {
      prisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'owner-id',
        currency: 'INR',
      });

      await expect(
        service.findOne('wallet-1', {
          userId: 'someone-else',
          role: UserRole.CUSTOMER,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an ADMIN to view a wallet they do not own', async () => {
      prisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'owner-id',
        currency: 'INR',
      });
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 250 } });

      const result = await service.findOne('wallet-1', {
        userId: 'admin-id',
        role: UserRole.ADMIN,
      });

      expect(result.balance).toBe(250);
    });

    it('returns the computed balance for the owner', async () => {
      prisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        currency: 'INR',
      });
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });

      const result = await service.findOne('wallet-1', {
        userId: 'user-1',
        role: UserRole.CUSTOMER,
      });

      expect(result.balance).toBe(0);
    });
  });

  describe('deposit', () => {
    const dto = { amount: 500, idempotencyKey: 'deposit-key-1' };

    it('returns the existing deposit without reprocessing when the idempotency key was already used', async () => {
      prisma.transfer.findUnique.mockResolvedValue({
        id: 'transfer-1',
        amount: 500,
        status: 'COMPLETED',
        description: null,
        createdAt: new Date(),
        ledgerEntries: [{ walletId: 'wallet-1', type: 'CREDIT', amount: 500 }],
      });

      const result = await service.deposit(
        'wallet-1',
        { userId: 'user-1', role: UserRole.CUSTOMER },
        dto,
      );

      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(prisma.transfer.create).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          transferId: 'transfer-1',
          walletId: 'wallet-1',
          amount: 500,
        }),
      );
    });

    it('throws not found when the wallet does not exist', async () => {
      prisma.transfer.findUnique.mockResolvedValue(null);
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(
        service.deposit(
          'missing-wallet',
          { userId: 'user-1', role: UserRole.CUSTOMER },
          dto,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws forbidden when depositing into someone else's wallet", async () => {
      prisma.transfer.findUnique.mockResolvedValue(null);
      prisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'owner-id',
        currency: 'INR',
      });

      await expect(
        service.deposit(
          'wallet-1',
          { userId: 'someone-else', role: UserRole.CUSTOMER },
          dto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates a single credit ledger entry for a valid deposit', async () => {
      prisma.transfer.findUnique.mockResolvedValue(null);
      prisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        currency: 'INR',
      });
      prisma.transfer.create.mockResolvedValue({
        id: 'transfer-2',
        amount: 500,
        status: 'COMPLETED',
        description: undefined,
        createdAt: new Date(),
        ledgerEntries: [{ walletId: 'wallet-1', type: 'CREDIT', amount: 500 }],
      });

      const result = await service.deposit(
        'wallet-1',
        { userId: 'user-1', role: UserRole.CUSTOMER },
        dto,
      );

      const createArgs = prisma.transfer.create.mock.calls[0][0];
      expect(createArgs.data.ledgerEntries.create).toEqual([
        { walletId: 'wallet-1', type: 'CREDIT', amount: 500 },
      ]);
      expect(result.transferId).toBe('transfer-2');
      expect(result.walletId).toBe('wallet-1');
    });

    it('returns the winning deposit when a concurrent duplicate request races on the idempotency key', async () => {
      prisma.transfer.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'transfer-winner',
          amount: 500,
          status: 'COMPLETED',
          description: null,
          createdAt: new Date(),
          ledgerEntries: [
            { walletId: 'wallet-1', type: 'CREDIT', amount: 500 },
          ],
        });
      prisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        currency: 'INR',
      });
      prisma.transfer.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.deposit(
        'wallet-1',
        { userId: 'user-1', role: UserRole.CUSTOMER },
        dto,
      );

      expect(result.transferId).toBe('transfer-winner');
    });
  });
});
