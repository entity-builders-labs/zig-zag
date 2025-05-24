# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./
COPY be/package.json ./be/

# Install dependencies
RUN yarn install

# Copy the rest of the application
COPY . .

# Install Prisma CLI and NestJS CLI globally
RUN yarn global add prisma @nestjs/cli

# Generate Prisma client
RUN yarn prisma:generate

# Build the application (using nest build directly)
WORKDIR /app/be
RUN npx nest build

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["yarn", "start:dev"] 