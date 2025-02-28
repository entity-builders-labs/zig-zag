import { registerAs } from '@nestjs/config';

export interface AiConfig {
  openaiApiKey: string;
  defaultModel: string;
  temperature: number;
  timeout: number;
}

export default registerAs('ai', (): AiConfig => {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    defaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-3.5-turbo',
    temperature: process.env.OPENAI_TEMPERATURE
      ? parseFloat(process.env.OPENAI_TEMPERATURE)
      : 0.7,
    timeout: process.env.OPENAI_TIMEOUT
      ? parseInt(process.env.OPENAI_TIMEOUT, 10)
      : 60000,
  };
});
