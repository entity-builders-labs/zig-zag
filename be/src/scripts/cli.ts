import { CommandFactory } from 'nest-commander';
import { ScriptsModule } from './commands/scripts.module';

async function bootstrap() {
  await CommandFactory.run(ScriptsModule, ['warn', 'error']);
}

bootstrap();
