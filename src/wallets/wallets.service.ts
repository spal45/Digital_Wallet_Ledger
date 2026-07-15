import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
}

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

  async findAllForUser(userId: string) {
    const wallets = await this.prisma.wallet.findMany({ where: { userId } });
    if (wallets.length === 0) {
      return [];
    }

    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['walletId'],
      where: { walletId: { in: wallets.map((wallet) => wallet.id) } },
      _sum: { amount: true },
    });
    const balanceByWalletId = new Map(
      sums.map((sum) => [sum.walletId, sum._sum.amount ?? 0]),
    );

    return wallets.map((wallet) => ({
      ...wallet,
      balance: balanceByWalletId.get(wallet.id) ?? 0,
    }));
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

  private async getBalance(walletId: string): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      where: { walletId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }
}
