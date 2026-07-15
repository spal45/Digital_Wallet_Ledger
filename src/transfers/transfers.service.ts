import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
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
import { CreateTransferDto } from './dto/create-transfer.dto';

interface LockedWalletRow {
  id: string;
  userId: string;
  currency: string;
}

@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(currentUser: AuthenticatedUser, dto: CreateTransferDto) {
    if (dto.fromWalletId === dto.toWalletId) {
      throw new BadRequestException('Cannot transfer a wallet to itself');
    }

    const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) {
      return this.toResponse(existing);
    }

    try {
      const transfer = await this.prisma.$transaction(
        async (tx) => {
          // Lock both wallets in a fixed order (by id) so two concurrent transfers
          // moving money in opposite directions between the same pair of wallets
          // can't deadlock on each other's locks.
          const [firstId, secondId] = [dto.fromWalletId, dto.toWalletId].sort();
          const lockedWallets = new Map<string, LockedWalletRow>();
          for (const walletId of [firstId, secondId]) {
            const rows = await tx.$queryRaw<LockedWalletRow[]>`
            SELECT id, user_id AS "userId", currency FROM wallets WHERE id = ${walletId}::uuid FOR UPDATE
          `;
            const wallet = rows[0];
            if (!wallet) {
              throw new NotFoundException(`Wallet ${walletId} not found`);
            }
            lockedWallets.set(walletId, wallet);
          }

          const fromWallet = lockedWallets.get(dto.fromWalletId)!;
          const toWallet = lockedWallets.get(dto.toWalletId)!;

          const isOwner = fromWallet.userId === currentUser.userId;
          const isPrivileged =
            currentUser.role === UserRole.ADMIN ||
            currentUser.role === UserRole.SUPPORT;
          if (!isOwner && !isPrivileged) {
            throw new ForbiddenException(
              'You do not have access to the source wallet',
            );
          }

          if (fromWallet.currency !== toWallet.currency) {
            throw new BadRequestException(
              'Cannot transfer between wallets with different currencies',
            );
          }

          const balanceResult = await tx.ledgerEntry.aggregate({
            where: { walletId: fromWallet.id },
            _sum: { amount: true },
          });
          const balance = balanceResult._sum.amount ?? 0;
          if (balance < dto.amount) {
            throw new UnprocessableEntityException('Insufficient balance');
          }

          return tx.transfer.create({
            data: {
              amount: dto.amount,
              idempotencyKey: dto.idempotencyKey,
              description: dto.description,
              status: TransferStatus.COMPLETED,
              ledgerEntries: {
                create: [
                  {
                    walletId: fromWallet.id,
                    type: EntryType.DEBIT,
                    amount: -dto.amount,
                  },
                  {
                    walletId: toWallet.id,
                    type: EntryType.CREDIT,
                    amount: dto.amount,
                  },
                ],
              },
            },
            include: { ledgerEntries: true },
          });
        },
        { maxWait: 30000, timeout: 30000 },
      );

      return this.toResponse(transfer);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // A concurrent request with the same idempotency key won the race; return its result.
        const winner = await this.findByIdempotencyKey(dto.idempotencyKey);
        if (winner) {
          return this.toResponse(winner);
        }
      }
      throw error;
    }
  }

  async findAllForUser(userId: string) {
    const transfers = await this.prisma.transfer.findMany({
      where: { ledgerEntries: { some: { wallet: { userId } } } },
      include: { ledgerEntries: true },
      orderBy: { createdAt: 'desc' },
    });
    return transfers.map((transfer) => this.toResponse(transfer));
  }

  async findOne(id: string, currentUser: AuthenticatedUser) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      include: { ledgerEntries: { include: { wallet: true } } },
    });
    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    const isPrivileged =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPPORT;
    const isParticipant = transfer.ledgerEntries.some(
      (entry) => entry.wallet.userId === currentUser.userId,
    );
    if (!isParticipant && !isPrivileged) {
      throw new ForbiddenException('You do not have access to this transfer');
    }

    return this.toResponse(transfer);
  }

  private findByIdempotencyKey(idempotencyKey: string) {
    return this.prisma.transfer.findUnique({
      where: { idempotencyKey },
      include: { ledgerEntries: true },
    });
  }

  private toResponse(transfer: Transfer & { ledgerEntries: LedgerEntry[] }) {
    const debit = transfer.ledgerEntries.find(
      (entry) => entry.type === EntryType.DEBIT,
    );
    const credit = transfer.ledgerEntries.find(
      (entry) => entry.type === EntryType.CREDIT,
    );

    return {
      id: transfer.id,
      fromWalletId: debit?.walletId,
      toWalletId: credit?.walletId,
      amount: transfer.amount,
      status: transfer.status,
      description: transfer.description,
      createdAt: transfer.createdAt,
    };
  }
}
