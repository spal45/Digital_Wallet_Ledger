# PostgreSQL — Learning Guide (with this project as the example)

PostgreSQL ("Postgres") is a relational database: data lives in **tables**
made of rows and typed columns, and tables relate to each other through
**foreign keys**. Prisma generates and runs the SQL for you, but
understanding what's actually happening underneath will make you much
better at debugging and reasoning about correctness — especially for a
financial ledger, where getting this wrong means money "disappears."

## Connecting to the database

The connection string lives in `.env` (not committed to git):

```
DATABASE_URL="postgresql://spal@localhost:5432/digital_wallet?schema=public"
```

Breaking that down:

```
postgresql://  <user>  @  <host>  :  <port>  /  <database>  ?schema=<schema>
               spal        localhost  5432     digital_wallet      public
```

- **user** — which Postgres role is connecting (here, `spal`, with no
  password since local trust auth is configured).
- **host:port** — `localhost:5432` is Postgres's default port.
- **database** — one Postgres *server* can host multiple databases;
  `digital_wallet` is this project's database.
- **schema** — inside a database, tables are further namespaced into
  schemas; `public` is the default one everything uses unless configured
  otherwise.

You can connect directly with the `psql` CLI to poke around:

```bash
psql "postgresql://spal@localhost:5432/digital_wallet"
```

Useful `psql` commands once connected:

| Command | What it does |
|---|---|
| `\dt` | List tables |
| `\d wallets` | Describe the `wallets` table's columns/constraints |
| `\du` | List roles/users |
| `SELECT * FROM users;` | Run a plain SQL query |
| `\q` | Quit |

## The tables in this project

Running `\dt` in this project's database shows:

```
 Schema |        Name        | Type
--------+--------------------+-------
 public | _prisma_migrations | table
 public | ledger_entries     | table
 public | transfers          | table
 public | users              | table
 public | wallets            | table
```

`_prisma_migrations` is Prisma's own bookkeeping table — it's how Prisma
tracks which migrations have already been applied to this specific
database, so it doesn't re-run them.

The other four map directly to the models in
[prisma/schema.prisma](../prisma/schema.prisma) — see the
[Prisma guide](./02-prisma.md) for the model-level explanation of *why*
they're shaped this way. This guide focuses on what Postgres itself is
doing with them.

## Primary keys, foreign keys, and why they matter

Every table has an `id` column that's a `UUID` and a `PRIMARY KEY` —
Postgres guarantees this value is unique and not null for every row, and
uses it to physically index the table so lookups by `id` are fast.

`wallets.user_id` is a **foreign key** referencing `users.id`. Postgres
enforces this at the database level: you cannot insert a wallet with a
`user_id` that doesn't exist in `users`, and (because the schema declares
`onDelete: Cascade`) deleting a user automatically deletes their wallets.
This is enforcement the *database* does — even if application code has a
bug and tries to insert bad data, Postgres rejects it. That's a much
stronger guarantee than "we remembered to check this in every service
method."

## Constraints seen in this schema

- `UNIQUE` on `users.email` — no two users can share an email.
- `UNIQUE` on `(wallets.user_id, wallets.currency)` — a composite
  constraint; one user can't have two wallets in the same currency.
- `UNIQUE` on `transfers.idempotency_key` — prevents the same transfer
  request from being processed twice.
- Index on `(ledger_entries.wallet_id, ledger_entries.type)` — not a
  constraint, but a performance structure: Postgres builds a sorted
  lookup structure so "find all entries for this wallet" doesn't require
  scanning every row in the table.

## Transactions — the most important concept for this project

A **transaction** is a group of SQL statements that either *all* succeed
or *all* fail together — there's no in-between state visible to anyone
else. Postgres guarantees this via **ACID**:

- **Atomicity** — all-or-nothing.
- **Consistency** — the database moves from one valid state to another
  (constraints are never violated, even mid-transaction).
- **Isolation** — concurrent transactions don't see each other's
  half-finished work.
- **Durability** — once committed, a transaction survives a crash.

Why this matters here: a `Transfer` of ₹10 from wallet A to wallet B needs
to create **two** `LedgerEntry` rows (a debit and a credit) and update the
`Transfer.status`. If the process crashed after writing the debit but
before the credit, you'd have money vanish. The fix is to wrap all of it
in a single database transaction, so either both ledger entries (and the
status update) happen, or none of them do.

In Prisma, this is `prisma.$transaction([...])` or the interactive form:

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.ledgerEntry.create({ data: { walletId: fromWalletId, type: 'DEBIT', amount: -amount, transferId } });
  await tx.ledgerEntry.create({ data: { walletId: toWalletId, type: 'CREDIT', amount: amount, transferId } });
  await tx.transfer.update({ where: { id: transferId }, data: { status: 'COMPLETED' } });
});
```

If any statement inside throws, Prisma automatically rolls back everything
in that block — Postgres discards all the changes as if they never
happened.

## Data types you'll see in this schema

| Postgres type | Prisma type | Used for |
|---|---|---|
| `uuid` | `String @db.Uuid` | All primary/foreign keys |
| `text` / `varchar` | `String` | Emails, descriptions |
| `integer` | `Int` | Money amounts (minor units), never `float`/`numeric` for money in a naive way |
| `timestamp` | `DateTime` | `createdAt`, `updatedAt` |
| `USER-DEFINED` (enum) | `enum` in Prisma | `UserRole`, `TransferStatus`, `EntryType` |

A quick note on money and types: Postgres does have a `numeric`/`decimal`
type for exact arbitrary-precision numbers, and some ledger systems use
that instead of integers. This project uses `Int` (whole minor units, e.g.
paise) — also exact, and simpler/faster, as long as every part of the
codebase consistently treats the value as "amount × 100" rather than
rupees.

## Where to go next

- Try running a few `SELECT` queries by hand with `psql` against
  `digital_wallet` to build intuition before relying purely on Prisma.
- Read the [Prisma guide](./02-prisma.md) to see how the schema you're
  looking at in SQL maps back to the TypeScript model definitions.
- Official docs: https://www.postgresql.org/docs/current/tutorial.html
