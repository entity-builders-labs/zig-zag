# Use Node.js LTS version
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./
COPY be/package.json ./be/

# Install dependencies
RUN yarn install --frozen-lockfile

# Build the application
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/be/node_modules ./be/node_modules

# Copy the rest of the application
COPY . .

# Install Prisma CLI and NestJS CLI globally
RUN yarn global add prisma @nestjs/cli

# Generate Prisma client
WORKDIR /app/be
RUN yarn prisma:generate

# Build the application
RUN yarn build

# Verify build output
RUN ls -la dist/ || (echo "Build failed - dist directory not found" && exit 1)
RUN test -f dist/src/main.js || (echo "Build failed - dist/src/main.js not found" && ls -la dist/ && exit 1)

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install netcat (nc) and coreutils (for timeout command) for checking PostgreSQL service availability in Docker
# This is needed by docker-entrypoint.sh and setup-db.sh
RUN apk add --no-cache netcat-openbsd coreutils

# Install Prisma CLI for migrations
RUN yarn global add prisma

# Copy built application
COPY --from=builder /app/be/dist ./be/dist
COPY --from=builder /app/be/node_modules ./be/node_modules
COPY --from=builder /app/be/package.json ./be/package.json
COPY --from=builder /app/be/prisma ./be/prisma
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
    echo '  sh scripts/setup-db.sh || echo "⚠️  Database setup failed, continuing anyway..."' >> /app/be/start.sh && \
    echo 'else' >> /app/be/start.sh && \
    echo '  echo "⚠️  Setup script not found, skipping..."' >> /app/be/start.sh && \
    echo 'fi' >> /app/be/start.sh && \
    echo 'echo "🚀 Starting application..."' >> /app/be/start.sh && \
    echo 'exec node dist/src/main.js' >> /app/be/start.sh && \
    chmod +x /app/be/start.sh

# Command to run the application
CMD ["/app/be/start.sh"]