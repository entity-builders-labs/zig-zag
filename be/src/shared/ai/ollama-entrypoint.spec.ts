import { spawnSync } from 'child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

describe('scripts/ollama-entrypoint.sh', () => {
  let fixtureDirectory: string;
  let fakeOllamaPath: string;
  let modelStatePath: string;
  let pullLogPath: string;
  const entrypoint = resolve(
    __dirname,
    '../../../../scripts/ollama-entrypoint.sh',
  );

  beforeEach(() => {
    fixtureDirectory = mkdtempSync(`${tmpdir()}/zigzag-ollama-entrypoint-`);
    fakeOllamaPath = resolve(fixtureDirectory, 'ollama');
    modelStatePath = resolve(fixtureDirectory, 'models');
    pullLogPath = resolve(fixtureDirectory, 'pulls');
    writeFileSync(
      fakeOllamaPath,
      `#!/bin/sh
case "$1" in
  serve) exit 0 ;;
  list)
    echo "NAME ID SIZE MODIFIED"
    [ -f "$FAKE_MODEL_STATE" ] && cat "$FAKE_MODEL_STATE"
    exit 0
    ;;
  pull)
    echo "$2" >> "$FAKE_PULL_LOG"
    [ "$2" = "$FAKE_FAIL_MODEL" ] && exit 1
    echo "$2:latest fake-id 1GB now" >> "$FAKE_MODEL_STATE"
    ;;
esac
`,
    );
    chmodSync(fakeOllamaPath, 0o755);
  });

  afterEach(() => {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  function run(overrides: Record<string, string>) {
    return spawnSync('/bin/sh', [entrypoint], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureDirectory}:${process.env.PATH}`,
        FAKE_MODEL_STATE: modelStatePath,
        FAKE_PULL_LOG: pullLogPath,
        ...overrides,
      },
    });
  }

  function pulledModels(): string[] {
    try {
      return readFileSync(pullLogPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  it('pulls only the model for operations configured with Ollama', () => {
    const result = run({
      AI_PROVIDER: 'groq',
      OLLAMA_MODEL: 'openai/gpt-oss-120b',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDINGS_MODEL: 'nomic-embed-text',
    });

    expect(result.status).toBe(0);
    expect(pulledModels()).toEqual(['nomic-embed-text']);
    expect(result.stdout).toContain('skipping Ollama chat-model pull');
  });

  it('fails instead of claiming readiness when a required model cannot be pulled', () => {
    const result = run({
      AI_PROVIDER: 'groq',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDINGS_MODEL: 'missing-embedding-model',
      FAKE_FAIL_MODEL: 'missing-embedding-model',
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(
      'Failed to pull required embeddings model missing-embedding-model',
    );
    expect(result.stdout).not.toContain('All models are ready');
  });

  it('does not pull any Ollama model when neither operation uses Ollama', () => {
    const result = run({
      AI_PROVIDER: 'groq',
      EMBEDDING_PROVIDER: 'bedrock',
    });

    expect(result.status).toBe(0);
    expect(pulledModels()).toEqual([]);
  });
});
