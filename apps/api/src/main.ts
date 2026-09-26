import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Must be set before any HTTPS to club 1C (:8445 self-signed / expired cert).
// apps/api/.env is loaded by ConfigModule later; set a safe local default now.
if (
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined &&
  process.env.NODE_ENV !== 'production'
) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');

  // PORT — PaaS (Railway/Render); API_PORT — local / VPS
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`FITGO API running on http://localhost:${port}`);
}

bootstrap();
