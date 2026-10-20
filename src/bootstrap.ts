import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { json } from 'express';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  app.getHttpAdapter().getInstance().set('trust proxy', config.get<number>('TRUST_PROXY_HOPS', 0));
  app.use(helmet());
  app.use(
    (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      if (req.path.startsWith('/api/v1/admin')) res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.use(json({ limit: '16kb' }));
  app.enableCors({
    origin: config
      .getOrThrow<string>('FRONTEND_ORIGINS')
      .split(',')
      .map((v) => v.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}
