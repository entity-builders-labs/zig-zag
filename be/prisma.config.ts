import { defineConfig } from 'prisma/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Try to load .env from current directory
dotenv.config();

// If DATABASE_URL is not found, try to load from root directory
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
}

// Build datasource config
// DATABASE_URL must be available for Prisma to work
// In Fly.io, this is set as an environment variable
const datasource: { url: string; shadowDatabaseUrl?: string } = {
  url: process.env.DATABASE_URL || '',
};

// Only set shadowDatabaseUrl if DIRECT_URL is different from DATABASE_URL
// Shadow database is only needed for migrations, not for db push
// Prisma will error if shadowDatabaseUrl is the same as the main database URL
if (
  process.env.DIRECT_URL &&
  process.env.DIRECT_URL !== process.env.DATABASE_URL
) {
  datasource.shadowDatabaseUrl = process.env.DIRECT_URL;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource,
});
