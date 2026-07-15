import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: {
    wallet: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    ledgerEntry: { groupBy: jest.Mock; aggregate: jest.Mock };
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
});
