# Prisma — Learning Guide (with this project as the example)

Prisma is an ORM (Object-Relational Mapper) for Node.js/TypeScript. Instead
of writing raw SQL by hand, you describe your database structure in a
**schema file**, and Prisma generates a fully-typed client you call from
TypeScript. It also manages **migrations** — versioned, repeatable changes to
your database structure.

## The three files that make up "Prisma" in this project

1. [prisma/schema.prisma](../prisma/schema.prisma) — your data model
   (source of truth for what tables/columns exist).
2. [prisma.config.ts](../prisma.config.ts) — tells the Prisma CLI where the
   schema lives and how to load the database connection string.
3. [src/prisma/prisma.service.ts](../src/prisma/prisma.service.ts) — the
   NestJS wrapper that makes the generated Prisma Client injectable
   throughout the app.

## The schema, piece by piece

```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}
```

- `datasource` says "I'm using PostgreSQL." The actual connection string
  comes from `DATABASE_URL` (set in `.env`, loaded via `prisma.config.ts`
  for the CLI and via `dotenv/config` in `main.ts` for the running app).
- `generator client` tells Prisma "generate a TypeScript client I can
  import as `@prisma/client`." This generated code lives in
  `node_modules/.prisma/client` and is regenerated any time you run
  `npx prisma generate` (or `prisma migrate dev`, which does it for you).

### Enums

```prisma
enum UserRole {
  CUSTOMER
  SUPPORT
  ADMIN
}

enum TransferStatus {
  PENDING
  COMPLETED
  FAILED
  REVERSED
}

enum EntryType {
  DEBIT
  CREDIT
}
```

These become real Postgres enum types *and* real TypeScript union types —
you get autocomplete and compile-time checking when you write
`role: 'ADMIN'` instead of a typo like `'Admin'`.

### Models = tables

```prisma
model User {
  id           String    @id @default(uuid()) @db.Uuid
  email        String    @unique
  passwordHash String    @map("password_hash")
  role         UserRole  @default(CUSTOMER)
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  wallets      Wallet[]

  @@map("users")
}
```

Reading this field by field:

- `@id` — this is the primary key.
- `@default(uuid())` — Postgres generates a random UUID when a row is
  inserted, instead of you supplying one.
- `@db.Uuid` — store this as a native Postgres `UUID` column (not text).
- `@unique` — no two rows can have the same `email`.
- `@map("password_hash")` — in TypeScript this field is called
  `passwordHash` (camelCase, idiomatic JS), but the actual Postgres column
  is named `password_hash` (snake_case, idiomatic SQL). `@map` bridges the
  naming convention gap.
- `@@map("users")` — same idea, but for the table name itself: the Prisma
  model is `User` (singular, PascalCase — idiomatic for a TS class), the
  Postgres table is `users` (plural, snake_case — idiomatic SQL).
- `wallets Wallet[]` — this isn't a real column. It's a **relation field**:
  "a User has many Wallets." Prisma uses this to let you write
  `prisma.user.findUnique({ where: { id }, include: { wallets: true } })`.

### Relations

```prisma
model Wallet {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  currency String @default("INR")
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
  @@unique([userId, currency])
}
```

- `userId` is the actual foreign key column.
- `@relation(fields: [userId], references: [id])` tells Prisma "`userId`
  points at `User.id`" — this is what generates the SQL `FOREIGN KEY`
  constraint.
- `onDelete: Cascade` — if a `User` row is deleted, Postgres automatically
  deletes their wallets too (rather than leaving orphaned rows or blocking
  the delete).
- `@@unique([userId, currency])` — a **composite unique constraint**: one
  user can't have two wallets in the same currency, but *can* have one INR
  wallet and one USD wallet.

## The ledger design — why two tables (`Transfer` + `LedgerEntry`)?

This project models money movement using **double-entry bookkeeping**,
which is the standard, audit-safe way to build a ledger:

```prisma
model Transfer {
  id             String         @id @default(uuid()) @db.Uuid
  amount         Int
  idempotencyKey String         @unique @map("idempotency_key")
  status         TransferStatus @default(PENDING)
  ledgerEntries  LedgerEntry[]
}

model LedgerEntry {
  id         String    @id @default(uuid()) @db.Uuid
  walletId   String    @map("wallet_id") @db.Uuid
  transferId String    @map("transfer_id") @db.Uuid
  type       EntryType
  amount     Int
  wallet     Wallet    @relation(fields: [walletId], references: [id])
  transfer   Transfer  @relation(fields: [transferId], references: [id], onDelete: Cascade)

  @@index([walletId, type])
}
```

- A `Transfer` represents "move ₹10 from wallet A to wallet B." It's the
  *intent/event*.
- A `LedgerEntry` represents one side of that movement hitting one wallet.
  Every transfer produces (at least) **two** ledger entries: a `DEBIT` on
  the source wallet and a `CREDIT` on the destination wallet.
- A wallet's balance is never stored as a single mutable number — it's
  **computed** by summing that wallet's `LedgerEntry.amount` values. This
  is deliberate: it makes the ledger append-only and auditable (nothing
  ever silently overwrites a balance), which is exactly how real financial
  systems avoid "where did this money go?" bugs.
- `idempotencyKey` on `Transfer` is a common financial-API pattern: if a
  client retries the same "send money" request (e.g. after a network
  timeout), the unique constraint lets the server recognize "I already
  processed this" instead of double-charging.
- `amount` is an `Int` representing **minor units** (e.g. paise/cents), not
  a float — see `Int // Stored in micro-units/cents` comment in the schema.
  Floating point numbers cannot represent money exactly (`0.1 + 0.2 !==
  0.3` in almost every language), so financial systems store integers and
  divide by 100 (or whatever the minor-unit ratio is) only for display.
- `@@index([walletId, type])` — creates a database index so that "give me
  all DEBIT entries for wallet X" (the query you'd run to compute a
  balance) is fast even with millions of rows, instead of scanning the
  whole table.

## Migrations — how the schema becomes real tables

You never write `CREATE TABLE` by hand. Instead:

```bash
npx prisma migrate dev --name add_wallets
```

This command:
1. Diffs your `schema.prisma` against the database's current state.
2. Generates a SQL file under `prisma/migrations/<timestamp>_add_wallets/`.
3. Applies that SQL to your database.
4. Regenerates the TypeScript client so your code's types match reality.

Every migration is checked into git, so any teammate (or CI environment)
can run `npx prisma migrate deploy` and end up with an identical schema.
You can see which migrations have already run via the `_prisma_migrations`
table Prisma creates automatically (`psql ... -c '\dt'` will show it).

## `PrismaService` — making the client injectable in Nest

Prisma 7 changed how the client connects: it no longer reads
`DATABASE_URL` implicitly. You must hand it a **driver adapter**
explicitly. That's what [prisma.service.ts](../src/prisma/prisma.service.ts)
does:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- `extends PrismaClient` — `PrismaService` *is a* `PrismaClient` with extra
  Nest lifecycle behavior bolted on. Anywhere you inject `PrismaService`,
  you get every generated method (`prisma.user.findMany()`,
  `prisma.wallet.create()`, etc.) for free.
- `new PrismaPg({ connectionString: ... })` — the actual TCP connection to
  Postgres is handled by the `pg` npm package; `PrismaPg` is a thin adapter
  that lets Prisma's query engine talk through it.
- `OnModuleInit` / `OnModuleDestroy` are Nest lifecycle hooks — Nest calls
  `onModuleInit()` once, right after the app finishes wiring up all
  modules, and `onModuleDestroy()` when the app is shutting down. This is
  how the database connection opens exactly once at startup and closes
  cleanly on shutdown, instead of every injected instance managing its own
  connection.

Because `PrismaModule` is `@Global()` (see the [NestJS guide](./01-nestjs.md)),
any service in the app can do:

```ts
constructor(private readonly prisma: PrismaService) {}

async findWallet(id: string) {
  return this.prisma.wallet.findUnique({ where: { id } });
}
```

## Common commands you'll actually use

| Command | What it does |
|---|---|
| `npx prisma migrate dev --name X` | Create + apply a new migration in dev |
| `npx prisma migrate deploy` | Apply pending migrations (prod/CI) |
| `npx prisma generate` | Regenerate the TypeScript client from the schema |
| `npx prisma studio` | Opens a local GUI to browse/edit your data |

## Where to go next

- Read the [PostgreSQL guide](./03-postgresql.md) to understand what's
  actually happening on the database side when a migration runs.
- Official docs: https://www.prisma.io/docs
