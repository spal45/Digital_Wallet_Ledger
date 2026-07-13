# NestJS — Learning Guide (with this project as the example)

NestJS is a Node.js framework for building server-side applications. It borrows
heavily from Angular's ideas: everything is organized into **modules**, and
classes get their dependencies handed to them automatically instead of
creating those dependencies themselves (**dependency injection**, or DI).

If you're new to this, the mental model is: *"I declare what a piece of code
needs in its constructor, and Nest figures out how to build and hand it over."*

## The three building blocks

Every feature in a Nest app is (almost always) made of three pieces that work
together. This project has one folder per feature — [src/auth](../src/auth),
[src/wallets](../src/wallets), [src/transfers](../src/transfers),
[src/webhooks](../src/webhooks) — and each folder follows the same pattern.

### 1. Controller — handles HTTP requests

A controller maps URLs + HTTP methods to class methods. Look at
[src/app.controller.ts](../src/app.controller.ts):

```ts
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
```

- `@Controller()` — marks this class as a controller. The string argument
  (empty here) is the URL prefix. [WalletsController](../src/wallets/wallets.controller.ts)
  uses `@Controller('wallets')`, so all its routes start with `/wallets`.
- `@Get()` — this method handles `GET` requests. There's also `@Post()`,
  `@Patch()`, `@Delete()`, etc.
- The controller's job is **only** to receive the request and return a
  response — it should not contain business logic. That belongs in a service.

### 2. Provider / Service — holds business logic

A service is a plain class decorated with `@Injectable()`, meaning Nest is
allowed to construct it and inject it into anything that asks for it. See
[src/app.service.ts](../src/app.service.ts):

```ts
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
```

Right now [wallets.service.ts](../src/wallets/wallets.service.ts),
[transfers.service.ts](../src/transfers/transfers.service.ts), and
[auth.service.ts](../src/auth/auth.service.ts) are empty stubs — this is
where you'll write things like "create a wallet," "move money between two
wallets," "hash a password and issue a JWT," etc.

### 3. Module — wires controllers and providers together

A module is a class decorated with `@Module()` that declares which
controllers and providers belong together. See
[src/wallets/wallets.module.ts](../src/wallets/wallets.module.ts):

```ts
@Module({
  providers: [WalletsService],
  controllers: [WalletsController],
})
export class WalletsModule {}
```

The **root module**, [src/app.module.ts](../src/app.module.ts), imports every
feature module so the whole app assembles into one tree:

```ts
@Module({
  imports: [AuthModule, WalletsModule, TransfersModule, WebhooksModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

## Dependency injection, concretely

When you write:

```ts
constructor(private readonly appService: AppService) {}
```

you're not creating an `AppService` yourself. You're telling Nest "this
class needs an `AppService` instance." Nest looks at `AppModule`, sees
`AppService` listed under `providers`, constructs one, and passes it in.
This is why `AppService` doesn't need a `new AppService()` anywhere in the
code — Nest's DI container does that for you.

This matters a lot for [PrismaService](../src/prisma/prisma.service.ts)
(covered in the Prisma guide) — instead of every service creating its own
database connection, one `PrismaService` instance is created and shared
everywhere it's injected.

### `@Global()` modules

[src/prisma/prisma.module.ts](../src/prisma/prisma.module.ts) is marked
`@Global()`:

```ts
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Normally, if `ModuleA` wants to use a provider from `ModuleB`, `ModuleB` must
`export` it and `ModuleA` must `import` `ModuleB`. `@Global()` is an
exception: once a global module is imported *once* (here, in `AppModule`),
its exported providers (`PrismaService`) become injectable from *any* module
in the app without each one importing `PrismaModule` individually. That's
why `WalletsService` will be able to inject `PrismaService` directly even
though `WalletsModule` never imports `PrismaModule`.

## Bootstrapping the app

[src/main.ts](../src/main.ts) is the actual entry point — the file Node runs:

```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

`NestFactory.create(AppModule)` walks the entire module tree starting from
`AppModule`, builds every controller and provider in dependency order, and
returns a running HTTP application. `app.listen(3000)` starts the actual
HTTP server.

## How a request flows through this app (once wallets is implemented)

1. A client sends `GET /wallets/some-id`.
2. Nest's router matches it to a method in `WalletsController` decorated
   with a matching `@Get(':id')`.
3. That controller method calls `this.walletsService.someMethod(...)`.
4. `WalletsService` (injected via DI) does the actual work, likely calling
   `this.prisma.wallet.findUnique(...)` using the injected `PrismaService`.
5. The result bubbles back up through the service, then the controller,
   and Nest serializes it to JSON for the HTTP response.

## Key decorators cheat sheet

| Decorator | Used on | Purpose |
|---|---|---|
| `@Module()` | class | Groups controllers + providers into a cohesive unit |
| `@Controller('path')` | class | Declares an HTTP route prefix |
| `@Injectable()` | class | Marks a class as available for DI |
| `@Global()` | class (with `@Module()`) | Makes a module's exports available everywhere |
| `@Get()`, `@Post()`, etc. | method | Maps an HTTP verb to a controller method |
| `@Body()`, `@Param()`, `@Query()` | method parameter | Extracts data from the incoming request |

## Where to go next

- Implement `AuthService`/`AuthController` first (register/login), since
  wallets and transfers will eventually need to know "which user is making
  this request."
- Read the [Prisma guide](./02-prisma.md) to understand how services will
  actually talk to the database.
- Official docs: https://docs.nestjs.com/first-steps
