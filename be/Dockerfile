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

# Install Prisma CLI for migrations
RUN yarn global add prisma

# Copy built application
COPY --from=builder /app/be/dist ./be/dist
COPY --from=builder /app/be/node_modules ./be/node_modules
COPY --from=builder /app/be/package.json ./be/package.json
COPY --from=builder /app/be/prisma ./be/prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose the port the app runs on
EXPOSE 3000

# Set working directory to backend
WORKDIR /app/be

# Verify the main file exists before starting
RUN test -f dist/src/main.js || (echo "ERROR: dist/src/main.js not found!" && ls -la dist/ && exit 1)

# Command to run the application
CMD ["node", "dist/src/main.js"]