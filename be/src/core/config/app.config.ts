export const appConfig = () => ({
  app: {
    port: parseInt(process.env.PORT, 10) || 3000,
    environment: process.env.NODE_ENV || 'development',
    name: process.env.APP_NAME || 'ZigZag API',
  },
  cors: {
    enabled: process.env.CORS_ENABLED === 'true',
    origin: process.env.CORS_ORIGIN || '*',
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
