import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type AiCacheMode = 'read' | 'write' | 'off';

@Injectable()
export class AiCacheService {
  private readonly logger = new Logger(AiCacheService.name);
  private readonly cacheDir: string;
  private readonly mode: AiCacheMode;

  constructor(private readonly config: ConfigService) {
    const storagePath =
      this.config.get<string>('STORAGE_PATH') ||
      path.join(process.cwd(), 'storage');
    this.cacheDir = path.join(storagePath, 'ai-cache');
    this.mode =
      (this.config.get<string>('AI_CACHE_MODE') as AiCacheMode) || 'off';

    if (this.mode !== 'off') {
      this.ensureCacheDir();
    }
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCacheKey(prompt: string, options?: any): string {
    // Normalize prompt and options to ensure consistent hashing
    const payload = {
      prompt,
      options: options || {},
    };
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(payload))
      .digest('hex');
    return `${hash}.json`;
  }

  async getCachedResponse(
    prompt: string,
    options?: any,
  ): Promise<string | null> {
    if (this.mode === 'off') return null;

    const key = this.getCacheKey(prompt, options);
    const filePath = path.join(this.cacheDir, key);

    if (fs.existsSync(filePath)) {
      this.logger.debug(`AI Cache Hit: ${key}`);
      const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return cached.response;
    }

    if (this.mode === 'read') {
      // In read-only mode, if cache misses, we typically want to fail OR fall back to real API?
      // The plan says "Read Mode: Return cached response if exists". It doesn't explicitly say fail.
      // Usually caching is an optimization. But if we want deterministic offline testing, "read" usually implies "strict read".
      // However, let's assume if it returns null, the caller calls the real service.
      // If we want strict mocking, we might need a 'strict-read' mode.
      // For now, return null so real service is called (unless caller handles it).
      this.logger.warn(`AI Cache Miss in READ mode: ${key}`);
    }

    return null;
  }

  async cacheResponse(
    prompt: string,
    response: string,
    options?: any,
  ): Promise<void> {
    if (this.mode !== 'write') return;

    const key = this.getCacheKey(prompt, options);
    const filePath = path.join(this.cacheDir, key);

    try {
      const data = {
        timestamp: new Date().toISOString(),
        prompt,
        options,
        response,
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      this.logger.debug(`AI Cache Saved: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to save AI cache: ${error.message}`);
    }
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }
}
