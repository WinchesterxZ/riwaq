import 'reflect-metadata';
import './common/request.types';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  // Multiple explicitly configured origins are separated by commas.
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173').split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  // API routes live under /api/v1; /health and /ready stay at root.
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'ready'],
  });

  const docConfig = new DocumentBuilder()
    .setTitle('RIWAQ ERP API')
    .setDescription('Arabic-first ERP: finance, inventory, sales, purchasing and administration.')
    .setVersion('0.2.0')
    .build();
  const document = SwaggerModule.createDocument(app, docConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(config.get('API_PORT', 3000));
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`RIWAQ ERP API listening on http://localhost:${port}`);
}

void bootstrap();
