import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntryType,
  LedgerEntry,
  Prisma,
  Transfer,
  TransferStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { buildPaginationMeta } from '../common/dto/pagination-meta.dto';
import { DepositDto } from './dto/deposit.dto';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, currency: string) {
    try {
      const wallet = await this.prisma.wallet.create({
        data: { userId, currency },
      });
      return { ...wallet, balance: 0 };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A wallet in ${currency} already exists for this user`,
        );
      }
      throw error;
    }
  }

  async findAllForUser(userId: string, page: number, limit: number) {
    const [wallets, total] = await Promise.all([
      this.prisma.wallet.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.wallet.count({ where: { userId } }),
    ]);

    if (wallets.length === 0) {
      return { data: [], meta: buildPaginationMeta(total, page, limit) };
    }

    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['walletId'],
      where: { walletId: { in: wallets.map((wallet) => wallet.id) } },
      _sum: { amount: true },
    });
    const balanceByWalletId = new Map(
      sums.map((sum) => [sum.walletId, sum._sum.amount ?? 0]),
    );

    const data = wallets.map((wallet) => ({
      ...wallet,
      balance: balanceByWalletId.get(wallet.id) ?? 0,
    }));

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(walletId: string, currentUser: AuthenticatedUser) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const isOwner = wallet.userId === currentUser.userId;
    const isPrivileged =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPPORT;
    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException('You do not have access to this wallet');
    }

    const balance = await this.getBalance(walletId);
    return { ...wallet, balance };
  }

  async deposit(
    walletId: string,
    currentUser: AuthenticatedUser,
    dto: DepositDto,
  ) {
    const existing = await this.findTransferByIdempotencyKey(
      dto.idempotencyKey,
    );
    if (existing) {
      return this.toDepositResponse(existing, walletId);
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const isOwner = wallet.userId === currentUser.userId;
    const isPrivileged =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPPORT;
    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException('You do not have access to this wallet');
    }

    try {
      const transfer = await this.prisma.transfer.create({
        data: {
          amount: dto.amount,
          idempotencyKey: dto.idempotencyKey,
          description: dto.description,
          status: TransferStatus.COMPLETED,
          ledgerEntries: {
            create: [{ walletId, type: EntryType.CREDIT, amount: dto.amount }],
          },
        },
        include: { ledgerEntries: true },
      });
      return this.toDepositResponse(transfer, walletId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // A concurrent request with the same idempotency key won the race; return its result.
        const winner = await this.findTransferByIdempotencyKey(
          dto.idempotencyKey,
        );
        if (winner) {
          return this.toDepositResponse(winner, walletId);
        }
      }
      throw error;
    }
  }

  private async getBalance(walletId: string): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      where: { walletId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  private findTransferByIdempotencyKey(idempotencyKey: string) {
    return this.prisma.transfer.findUnique({
      where: { idempotencyKey },
      include: { ledgerEntries: true },
    });
  }

  private toDepositResponse(
    transfer: Transfer & { ledgerEntries: LedgerEntry[] },
    walletId: string,
  ) {
    return {
      transferId: transfer.id,
      walletId,
      amount: transfer.amount,
      status: transfer.status,
      description: transfer.description,
      createdAt: transfer.createdAt,
    };
  }
}
