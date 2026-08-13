export const appConfig = () => ({
  app: {
    port: parseInt(process.env.PORT, 10) || 3000,
    environment: process.env.NODE_ENV || 'development',
    name: process.env.APP_NAME || 'ZigZag API',
  },
  cors: {
    // No production default here on purpose — main.ts refuses to boot in
    // production without an explicit CORS_ORIGIN instead of silently
    // reflecting any Origin. Non-production keeps the permissive '*' default
    // since local/dev callers vary (simulator, web, docker-compose).
    origin:
      process.env.CORS_ORIGIN ||
      (process.env.NODE_ENV === 'production' ? '' : '*'),
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
    title: 'ZigZag API',
    description: 'API for ZigZag travel application',
    version: '1.0',
    path: 'api/docs',
  },
  defaults: {
    location: {
      latitude: -34.5209462,
      longitude: -58.4972602,
    },
  },
});
