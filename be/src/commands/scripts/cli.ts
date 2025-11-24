import { CommandFactory } from 'nest-commander';
import { ScriptsModule } from './commands/scripts.module';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from root of monorepo
// When running with ts-node: __dirname = be/src/commands/scripts -> go up 4 levels to monorepo root
// When compiled: __dirname = be/dist/commands/scripts -> go up 4 levels to monorepo root
// be/src/commands/scripts -> ../ -> be/src/commands -> ../ -> be/src -> ../ -> be -> ../ -> root
const rootEnvPath = path.resolve(__dirname, '../../../../', '.env');
const beEnvPath = path.resolve(__dirname, '../../..', '.env'); // be/.env as fallback

// Try to load .env from root first (monorepo root), then be/ directory
// dotenv.config() doesn't throw if file doesn't exist, so it's safe
const rootResult = dotenv.config({ path: rootEnvPath });
const beResult = dotenv.config({ path: beEnvPath }); // This will override if exists

if (rootResult.error && beResult.error) {
  console.warn(`⚠️  Could not load .env from ${rootEnvPath} or ${beEnvPath}`);
} else if (rootResult.parsed) {
  console.log(`✓ Loaded .env from monorepo root: ${rootEnvPath}`);
} else if (beResult.parsed) {
  console.log(`✓ Loaded .env from be/ directory: ${beEnvPath}`);
}

async function bootstrap() {
  console.log('🚀 Starting CLI...');
  console.log(
    '📋 Available commands: audit-images, check-metadata, check-embeddings',
  );
  await CommandFactory.run(ScriptsModule, ['log', 'warn', 'error']);
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start CLI:', error);
  process.exit(1);
});
