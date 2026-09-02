import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import * as morgan from 'morgan';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'debug', 'log', 'verbose'],
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const isProduction =
    configService.get<string>('app.environment') === 'production';

  const corsOrigin = configService.get<string>('cors.origin');
  if (!corsOrigin) {
    throw new Error(
      'CORS_ORIGIN must be set in production (comma-separated origins, or "*" to allow any).',
    );
  }
  app.enableCors({
    // '*' as a literal string enables the cors package's wildcard handling —
    // passing it inside an array (['*']) does not, it's matched literally
    // against the Origin header and blocks everything.
    origin:
      corsOrigin === '*'
        ? true
        : corsOrigin
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    credentials: true,
  });

  // Swagger configuration
  const swagger = configService.get('swagger');
  if (swagger.enabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(swagger.title)
        .setDescription(swagger.description)
        .setVersion(swagger.version)
        .addTag('experiences')
        .addTag('tours')
        .build(),
    );
    SwaggerModule.setup(swagger.path, app, document);
  }

  // Add request logging middleware
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  // Custom logging middleware
  if (!isProduction) {
    app.use((req: any, _res: any, next: any) => {
      Logger.debug(`Incoming ${req.method} ${req.url}`);
      next();
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      enableDebugMessages: true,
      transformOptions: {
        enableImplicitConversion: true,
        exposeDefaultValues: true,
      },
      whitelist: true,
      validationError: {
        target: false,
        value: true,
      },
      exceptionFactory: (errors) => {
        const result = errors.map((error) => ({
          property: error.property,
          message: error.constraints
            ? Object.values(error.constraints)[0]
            : 'Invalid value',
          value: error.value,
        }));
        return new BadRequestException(result);
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
