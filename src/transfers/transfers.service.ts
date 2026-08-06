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
import { WebhooksService } from '../webhooks/webhooks.service';
import { buildPaginationMeta } from '../common/dto/pagination-meta.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';

interface LockedWalletRow {
  id: string;
  userId: string;
  currency: string;
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooksService: WebhooksService,
  ) {}

  async create(currentUser: AuthenticatedUser, dto: CreateTransferDto) {
    if (dto.fromWalletId === dto.toWalletId) {
      throw new BadRequestException('Cannot transfer a wallet to itself');
    }

    const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) {
      return this.toResponse(existing);
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { transfer, fromWallet, toWallet } =
          await this.executeTransferTransaction(currentUser, dto);

        this.webhooksService.notifyTransferCompleted(
          [fromWallet.userId, toWallet.userId],
          {
            transferId: transfer.id,
            fromWalletId: fromWallet.id,
            toWalletId: toWallet.id,
            amount: transfer.amount,
            status: transfer.status,
            createdAt: transfer.createdAt,
          },
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
          throw error;
        }

        // Postgres can report a false-cycle deadlock when many transactions queue
        // FOR UPDATE on the same row simultaneously, even with consistent lock
        // ordering (a documented multixact edge case under heavy contention).
        // Retrying the whole transaction, as Postgres's own docs recommend, is
        // the correct response - it's a transient condition, not a logic error.
        const isLastAttempt = attempt === maxAttempts;
        if (this.isDeadlockError(error) && !isLastAttempt) {
          continue;
        }
        throw error;
      }
    }

    /* istanbul ignore next -- unreachable: the loop above always returns or throws */
    throw new Error('Transfer failed after retries');
  }

  private executeTransferTransaction(
    currentUser: AuthenticatedUser,
    dto: CreateTransferDto,
  ) {
    return this.prisma.$transaction(
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

        const transfer = await tx.transfer.create({
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

        return { transfer, fromWallet, toWallet };
      },
      { maxWait: 30000, timeout: 30000 },
    );
  }

  private isDeadlockError(error: unknown): boolean {
    return (
      error instanceof Error && error.message.includes('deadlock detected')
    );
  }

  async reverse(transferId: string, description?: string) {
    const reversalKey = `reversal:${transferId}`;
    const existingReversal = await this.findByIdempotencyKey(reversalKey);
    if (existingReversal) {
      return this.toResponse(existingReversal);
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { reversal, fromWallet, toWallet } =
          await this.executeReversalTransaction(
            transferId,
            reversalKey,
            description,
          );

        this.webhooksService.notifyTransferReversed(
          [fromWallet.userId, toWallet.userId],
          {
            transferId: reversal.id,
            fromWalletId: fromWallet.id,
            toWalletId: toWallet.id,
            amount: reversal.amount,
            status: reversal.status,
            createdAt: reversal.createdAt,
            reversedTransferId: transferId,
          },
        );

        return this.toResponse(reversal);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // A concurrent duplicate reversal request won the race; return its result.
          const winner = await this.findByIdempotencyKey(reversalKey);
          if (winner) {
            return this.toResponse(winner);
          }
          throw error;
        }

        const isLastAttempt = attempt === maxAttempts;
        if (this.isDeadlockError(error) && !isLastAttempt) {
          continue;
        }
        throw error;
      }
    }

    /* istanbul ignore next -- unreachable: the loop above always returns or throws */
    throw new Error('Reversal failed after retries');
  }

  private executeReversalTransaction(
    originalTransferId: string,
    reversalKey: string,
    description?: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const original = await tx.transfer.findUnique({
          where: { id: originalTransferId },
          include: { ledgerEntries: true },
        });
        if (!original) {
          throw new NotFoundException('Transfer not found');
        }
        if (original.status !== TransferStatus.COMPLETED) {
          throw new BadRequestException(
            `Only completed transfers can be reversed (current status: ${original.status})`,
          );
        }

        const debitEntry = original.ledgerEntries.find(
          (entry) => entry.type === EntryType.DEBIT,
        );
        const creditEntry = original.ledgerEntries.find(
          (entry) => entry.type === EntryType.CREDIT,
        );
        if (!debitEntry || !creditEntry) {
          throw new BadRequestException(
            'Original transfer has no ledger entries to reverse',
          );
        }

        // Reversing means moving the money back: debit the original recipient,
        // credit the original sender. Same fixed-order locking as a normal
        // transfer, to stay consistent with the deadlock-avoidance strategy.
        const [firstId, secondId] = [
          debitEntry.walletId,
          creditEntry.walletId,
        ].sort();
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

        const originalFromWallet = lockedWallets.get(debitEntry.walletId)!;
        const originalToWallet = lockedWallets.get(creditEntry.walletId)!;

        const balanceResult = await tx.ledgerEntry.aggregate({
          where: { walletId: originalToWallet.id },
          _sum: { amount: true },
        });
        const balance = balanceResult._sum.amount ?? 0;
        if (balance < original.amount) {
          throw new UnprocessableEntityException(
            "Cannot reverse: the recipient's wallet no longer has sufficient balance",
          );
        }

        const reversal = await tx.transfer.create({
          data: {
            amount: original.amount,
            idempotencyKey: reversalKey,
            description: description ?? `Reversal of transfer ${original.id}`,
            status: TransferStatus.COMPLETED,
            ledgerEntries: {
              create: [
                {
                  walletId: originalToWallet.id,
                  type: EntryType.DEBIT,
                  amount: -original.amount,
                },
                {
                  walletId: originalFromWallet.id,
                  type: EntryType.CREDIT,
                  amount: original.amount,
                },
              ],
            },
          },
          include: { ledgerEntries: true },
        });

        await tx.transfer.update({
          where: { id: original.id },
          data: { status: TransferStatus.REVERSED },
        });

        // The response's "fromWallet"/"toWallet" reflect this new reversal
        // transfer's own direction (recipient -> original sender), not the
        // original transfer's direction.
        return {
          reversal,
          fromWallet: originalToWallet,
          toWallet: originalFromWallet,
        };
      },
      { maxWait: 30000, timeout: 30000 },
    );
  }

  async findAllForUser(userId: string, page: number, limit: number) {
    const where = { ledgerEntries: { some: { wallet: { userId } } } };
    const [transfers, total] = await Promise.all([
      this.prisma.transfer.findMany({
        where,
        include: { ledgerEntries: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transfer.count({ where }),
    ]);

    return {
      data: transfers.map((transfer) => this.toResponse(transfer)),
      meta: buildPaginationMeta(total, page, limit),
    };
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
