# Use Node.js LTS version
FROM node:22.23.1-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files first (for better cache)
COPY package.json yarn.lock ./
COPY be/package.json ./be/

# Install dependencies with cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.yarn \
    yarn install --frozen-lockfile --prefer-offline

# Build the application
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/be/node_modules ./be/node_modules

# Copy package files again (needed for Prisma)
COPY package.json yarn.lock ./
COPY be/package.json ./be/

# Install Prisma CLI and NestJS CLI globally (cache this layer)
RUN --mount=type=cache,target=/root/.yarn \
    yarn global add prisma @nestjs/cli

# Copy Prisma schema and config first (for better cache)
COPY be/prisma ./be/prisma
COPY be/prisma.config.ts ./be/prisma.config.ts

# Copy scripts (needed for setup-db.sh in production)
COPY be/scripts ./be/scripts

# Generate Prisma client
WORKDIR /app/be
RUN yarn prisma:generate

# Copy source code (this changes most frequently, so do it last)
# Since WORKDIR is /app/be, copy directly to current directory
COPY be/tsconfig*.json ./
COPY be/nest-cli.json ./
COPY be/src ./src

# Build the application
RUN yarn build

# Verify build output
RUN ls -la dist/ || (echo "Build failed - dist directory not found" && exit 1)
RUN test -f dist/src/main.js || (echo "Build failed - dist/src/main.js not found" && ls -la dist/ && exit 1)

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install system dependencies and Prisma CLI in one layer (cache this)
RUN apk add --no-cache netcat-openbsd coreutils && \
    yarn global add prisma

# Copy built application
COPY --from=builder /app/be/dist ./be/dist
COPY --from=builder /app/be/node_modules ./be/node_modules
COPY --from=builder /app/be/package.json ./be/package.json
COPY --from=builder /app/be/prisma ./be/prisma
COPY --from=builder /app/be/prisma.config.ts ./be/prisma.config.ts
COPY --from=builder /app/be/scripts ./be/scripts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose the port the app runs on
EXPOSE 3000

# Set working directory to backend
WORKDIR /app/be

# Verify the main file exists before starting
RUN test -f dist/src/main.js || (echo "ERROR: dist/src/main.js not found!" && ls -la dist/ && exit 1)

# Create startup script that runs DB setup then starts the app
RUN echo '#!/bin/sh' > /app/be/start.sh && \
    echo 'set -e' >> /app/be/start.sh && \
    echo 'echo "🔧 Running database setup..."' >> /app/be/start.sh && \
    echo 'if [ -f "scripts/setup-db.sh" ]; then' >> /app/be/start.sh && \
    echo '  echo "📋 Checking for migrations..."' >> /app/be/start.sh && \
    echo '  if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then' >> /app/be/start.sh && \
    echo '    echo "✅ Migrations directory found with $(ls -1 prisma/migrations | wc -l) migration(s)"' >> /app/be/start.sh && \
    echo '  else' >> /app/be/start.sh && \
    echo '    echo "⚠️  No migrations directory found"' >> /app/be/start.sh && \
    echo '  fi' >> /app/be/start.sh && \
    echo '  sh scripts/setup-db.sh || {' >> /app/be/start.sh && \
    echo '    EXIT_CODE=$?' >> /app/be/start.sh && \
    echo '    echo "❌ Database setup failed with exit code $EXIT_CODE"' >> /app/be/start.sh && \
    echo '    echo "⚠️  Continuing anyway, but application may not work correctly..."' >> /app/be/start.sh && \
    echo '  }' >> /app/be/start.sh && \
    echo 'else' >> /app/be/start.sh && \
    echo '  echo "⚠️  Setup script not found, skipping..."' >> /app/be/start.sh && \
    echo 'fi' >> /app/be/start.sh && \
    echo 'echo "🚀 Starting application..."' >> /app/be/start.sh && \
    echo 'exec node dist/src/main.js' >> /app/be/start.sh && \
    chmod +x /app/be/start.sh

# Command to run the application
CMD ["/app/be/start.sh"]