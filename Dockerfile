FROM node:20-slim AS base

# 1. Dependencies stage
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* bun.lockb* ./
RUN \
  if [ -f bun.lockb ]; then npm install -g bun && bun install; \
  elif [ -f package-lock.json ]; then npm ci; \
  else npm install; \
  fi

# 2. Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1
ENV STRIPE_API_KEY=sk_test_123
ENV STRIPE_WEBHOOK_SECRET=whsec_123
RUN npm run build

# 3. Production runner stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "npm_config_cache=/tmp/.npm npx -y prisma@6.7.0 migrate deploy && node server.js"]
