import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../src/app.module';

interface TokenBody {
  accessToken: string;
}
interface WalletBody {
  id: string;
  balance: number;
}
interface TransferBody {
  id: string;
}

// Proves the double-entry ledger's core safety guarantee: under concurrent
// load, a wallet can never be overdrawn and no money is created or
// destroyed. Runs against local Postgres only (see test/setup-local-db.ts).
describe('Transfers concurrency (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  const runId = Date.now();
  const emailA = `concurrency-a-${runId}@example.com`;
  const emailB = `concurrency-b-${runId}@example.com`;
  const password = 'password123';

  const AMOUNT_PER_TRANSFER = 100;
  const CONCURRENT_REQUESTS = 10;
  const INITIAL_BALANCE = 800; // exactly 8 transfers' worth; 2 requests must be rejected

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    // Derive cleanup targets from actual DB state (by email) rather than
    // tracking IDs through the test body - this way cleanup is correct even
    // if the test itself fails or crashes partway through.
    const users = await prisma.user.findMany({
      where: { email: { in: [emailA, emailB] } },
    });
    const userIds = users.map((user) => user.id);
    const wallets = await prisma.wallet.findMany({
      where: { userId: { in: userIds } },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: { in: walletIds } },
    });
    const transferIds = [...new Set(entries.map((entry) => entry.transferId))];

    await prisma.ledgerEntry.deleteMany({
      where: { walletId: { in: walletIds } },
    });
    if (transferIds.length > 0) {
      await prisma.transfer.deleteMany({ where: { id: { in: transferIds } } });
    }
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    await prisma.$disconnect();
    await app.close();
  }, 30000);

  it('never overdraws a wallet when many transfers race concurrently', async () => {
    const server = app.getHttpServer();

    await request(server)
      .post('/auth/register')
      .send({ email: emailA, password })
      .expect(201);
    const loginA = await request(server)
      .post('/auth/login')
      .send({ email: emailA, password })
      .expect(200);
    const tokenA = (loginA.body as TokenBody).accessToken;

    await request(server)
      .post('/auth/register')
      .send({ email: emailB, password })
      .expect(201);
    const loginB = await request(server)
      .post('/auth/login')
      .send({ email: emailB, password })
      .expect(200);
    const tokenB = (loginB.body as TokenBody).accessToken;

    const walletAResponse = await request(server)
      .post('/wallets')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(201);
    const walletA = (walletAResponse.body as WalletBody).id;

    const walletBResponse = await request(server)
      .post('/wallets')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
      .expect(201);
    const walletB = (walletBResponse.body as WalletBody).id;

    await request(server)
      .post(`/wallets/${walletA}/deposit`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        amount: INITIAL_BALANCE,
        idempotencyKey: `concurrency-deposit-${runId}`,
      })
      .expect(201);

    const transferRequests = Array.from(
      { length: CONCURRENT_REQUESTS },
      (_, index) =>
        request(server)
          .post('/transfers')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            fromWalletId: walletA,
            toWalletId: walletB,
            amount: AMOUNT_PER_TRANSFER,
            idempotencyKey: `concurrency-transfer-${runId}-${index}`,
          }),
    );

    const responses = await Promise.all(transferRequests);

    const succeeded = responses.filter((response) => response.status === 201);
    const rejectedForInsufficientBalance = responses.filter(
      (response) => response.status === 422,
    );
    const unexpected = responses.filter(
      (response) => response.status !== 201 && response.status !== 422,
    );

    const succeededTransferIds = succeeded.map(
      (response) => (response.body as TransferBody).id,
    );
    // Every successful transfer must be a genuinely distinct record - proves
    // none of the concurrent requests were double-processed against each other.
    expect(new Set(succeededTransferIds).size).toBe(
      succeededTransferIds.length,
    );

    const expectedSuccesses = Math.floor(INITIAL_BALANCE / AMOUNT_PER_TRANSFER);

    expect(unexpected).toHaveLength(0);
    expect(succeeded).toHaveLength(expectedSuccesses);
    expect(rejectedForInsufficientBalance).toHaveLength(
      CONCURRENT_REQUESTS - expectedSuccesses,
    );

    const finalWalletA = await request(server)
      .get(`/wallets/${walletA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const finalWalletB = await request(server)
      .get(`/wallets/${walletB}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const balanceA = (finalWalletA.body as WalletBody).balance;
    const balanceB = (finalWalletB.body as WalletBody).balance;

    // The core guarantee: never negative, no matter how many requests raced.
    expect(balanceA).toBeGreaterThanOrEqual(0);
    expect(balanceA).toBe(
      INITIAL_BALANCE - succeeded.length * AMOUNT_PER_TRANSFER,
    );
    // Conservation: every unit debited from A was credited to B, nothing lost or duplicated.
    expect(balanceB).toBe(succeeded.length * AMOUNT_PER_TRANSFER);
  }, 30000);
});
