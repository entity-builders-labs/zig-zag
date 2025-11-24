import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import OpenAI from 'openai';
import aiConfig from './ai.config';

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private openai: OpenAI;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {
    if (this.config.openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: this.config.openaiApiKey,
        timeout: this.config.timeout,
      });
    }
  }

  /**
   * Generate an image based on a prompt
   * @param prompt Description of the image to generate
   * @param size Size of the image (default: 1024x1024)
   * @returns URL of the generated image
   */
  async generateImage(
    prompt: string,
    size: '256x256' | '512x512' | '1024x1024' = '1024x1024',
  ): Promise<string | null> {
    if (!this.config.enableAi) {
      this.logger.warn('AI is disabled, skipping image generation');
      return null;
    }

    if (!this.openai) {
      this.logger.warn(
        'OpenAI client not initialized (missing API key), skipping image generation',
      );
      return null;
    }

    try {
      this.logger.log(
        `Generating image for prompt: ${prompt.substring(0, 50)}...`,
      );

      const response = await this.openai.images.generate({
        model: 'dall-e-3', // Use DALL-E 3 for better quality
        prompt: prompt,
        n: 1,
        size: '1024x1024', // DALL-E 3 supports 1024x1024, 1024x1792, 1792x1024
        quality: 'standard',
        response_format: 'url',
      });

      const imageUrl = response.data[0]?.url;

      if (!imageUrl) {
        this.logger.warn('No image URL returned from OpenAI');
        return null;
      }

      return imageUrl;
    } catch (error) {
      this.logger.error(
        `Failed to generate image: ${error.message}`,
        error.stack,
      );

      // Fallback to DALL-E 2 if DALL-E 3 fails or is not available
      if (error.code === 'model_not_found' || error.status === 400) {
        return this.generateImageDallE2(prompt, size);
      }

      return null;
    }
  }

  private async generateImageDallE2(
    prompt: string,
    size: '256x256' | '512x512' | '1024x1024',
  ): Promise<string | null> {
    try {
      this.logger.log(`Fallback: Generating image with DALL-E 2...`);
      const response = await this.openai.images.generate({
        model: 'dall-e-2',
        prompt: prompt,
        n: 1,
        size: size,
        response_format: 'url',
      });

      return response.data[0]?.url || null;
    } catch (error) {
      this.logger.error(
        `Failed to generate image with DALL-E 2: ${error.message}`,
      );
      return null;
    }
  }
}
