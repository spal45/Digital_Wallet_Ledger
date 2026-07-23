# ---- Stage 1: build ----
# Installs all dependencies (including dev deps needed to compile TypeScript
# and generate the Prisma client), then builds the app to plain JS in dist/.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Stage 2: production ----
# A clean image with only production dependencies and the compiled output -
# no TypeScript, no dev tools, no source .ts files. This is the image that
# actually ships and runs.
FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The generated Prisma client is portable (WASM-based query engine, not a
# native binary), so it's safe to copy from the builder stage as-is.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
