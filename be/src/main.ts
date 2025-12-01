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

  // Enable CORS
  app.enableCors();

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Zig Zag API')
    .setDescription('API for activities and tours management')
    .setVersion('1.0')
    .addTag('activities')
    .addTag('tours')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Add request logging middleware
  app.use(morgan('dev'));

  // Custom logging middleware
  app.use((req: any, res: any, next: any) => {
    Logger.debug(
      `Incoming ${req.method} ${req.url} request with query:`,
      JSON.stringify(req.query),
      JSON.stringify(req.body),
      JSON.stringify(req.params),
      JSON.stringify(req.error),
      JSON.stringify(req.cookies),
    );
    next();
  });

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
