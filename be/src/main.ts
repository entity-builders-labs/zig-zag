import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, BadRequestException } from '@nestjs/common';
import { AppModule } from './app.module';
import * as morgan from 'morgan';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'debug', 'log', 'verbose'],
    bufferLogs: true,
  });

  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Zig Zag API')
    .setDescription('API for activities and tours management')
    .setVersion('1.0')
    .addTag('activities')
    .addTag('tours')
    .build();

  if (process.env.SWAGGER_ENABLED === 'true') {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Add request logging middleware
  const isProduction = process.env.NODE_ENV === 'production';
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
