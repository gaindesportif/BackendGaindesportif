import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  await app.listen(app.get(ConfigService).get<number>('PORT', 4000), '0.0.0.0');
}
bootstrap().catch(() => {
  console.error(
    'Démarrage impossible. Vérifiez la configuration et la disponibilité des services.',
  );
  process.exitCode = 1;
});
