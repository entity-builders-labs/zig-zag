import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class AiCacheService {
  private readonly logger = new Logger(AiCacheService.name);
  private readonly cacheDir: string;
  private readonly mode: 'read' | 'write' | 'off';

  constructor() {
    this.cacheDir = path.join(process.cwd(), 'storage', 'ai_cache');
    const envMode = process.env.AI_CACHE_MODE || 'off';
    this.mode = ['read', 'write', 'off'].includes(envMode)
      ? (envMode as any)
      : 'off';

    if (this.mode !== 'off') {
      this.ensureCacheDir();
      this.logger.log(`Initialized AiCacheService in mode: ${this.mode}`);
    }
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCacheKey(
    prompt: string,
    model: string,
    variables: Record<string, any> = {},
  ): string {
    const stableVariables = JSON.stringify(
      variables,
      Object.keys(variables).sort(),
    );
    const content = `${model}|${prompt}|${stableVariables}`;
    const hash = crypto.createHash('md5').update(content).digest('hex');
    return `ai_${hash}.json`;
  }

  get(
    prompt: string,
    model: string,
    variables: Record<string, any> = {},
  ): string | null {
    if (this.mode === 'off') return null;

    const key = this.getCacheKey(prompt, model, variables);
    const cachePath = path.join(this.cacheDir, key);

    if (fs.existsSync(cachePath)) {
      this.logger.debug(`[AI CACHE HIT] ${key}`);
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.response;
    }

    return null;
  }

  save(
    prompt: string,
    model: string,
    variables: Record<string, any>,
    response: string,
  ): void {
    if (this.mode !== 'write') return;

    const key = this.getCacheKey(prompt, model, variables);
    const cachePath = path.join(this.cacheDir, key);

    const data = {
      timestamp: new Date().toISOString(),
      prompt,
      model,
      variables,
      response,
    };

    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    this.logger.debug(`[AI CACHE SAVED] ${key}`);
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }
}
