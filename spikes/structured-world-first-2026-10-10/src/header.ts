import { execSync } from 'child_process';

export interface RunArgs2 {
  run: string;
  mode: 'live' | 'record' | 'replay';
  envFile?: string;
  aiProvider?: string;
}

export function parseArgs2(argv: string[]): RunArgs2 {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = (get('--mode') ?? 'replay') as RunArgs2['mode'];
  if (!['live', 'record', 'replay'].includes(mode)) throw new Error(`invalid --mode ${mode}`);
  return {
    run: get('--run') ?? 'EMPTY',
    mode,
    ...(get('--env-file') ? { envFile: get('--env-file') } : {}),
    ...(get('--ai-provider') ? { aiProvider: get('--ai-provider') } : {}),
  };
}

export function traceHeader2(args: RunArgs2): Record<string, string> {
  const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  return {
    spike: 'structured-world-first-2026-10-10',
    run: args.run,
    mode: args.mode,
    branch: git('rev-parse --abbrev-ref HEAD'),
    commit: git('rev-parse --short HEAD'),
    startedAt: new Date().toISOString(),
  };
}
