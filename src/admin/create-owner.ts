import 'dotenv/config';
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { createInterface } from 'node:readline/promises';
import { DatabaseService } from '../database/database.service';
import { hashPassword } from './password';
import { newAdminUsernamePattern } from './admin.dto';
import { validateEnvironment } from '../config/environment';

function hiddenQuestion(label: string): Promise<string> {
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (data: Buffer) => {
      for (const character of data.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new Error('cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && value.length < 129) value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('tty-required');
  const args = process.argv.slice(2);
  const update = args.length === 1 && args[0] === '--update';
  if (args.length && !update) throw new Error('arguments-not-supported');
  const db = new DatabaseService(new ConfigService(validateEnvironment(process.env)));
  try {
    if (!update && (await db.adminAccount.count({ where: { role: 'owner' } }))) {
      process.stdout.write(
        'Un propriétaire existe déjà. Pour modifier ses accès, utilisez --update.\n',
      );
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let currentUsername = '';
    let username: string;
    let displayName = '';
    try {
      if (update)
        currentUsername = (await rl.question('Identifiant propriétaire actuel : ')).trim();
      username = (await rl.question('Nouvel identifiant propriétaire (4–60 caractères) : ')).trim();
      if (!update) displayName = (await rl.question('Nom affiché : ')).trim();
    } finally {
      rl.close();
    }
    if (
      !newAdminUsernamePattern.test(username) ||
      (update ? !currentUsername : displayName.length < 2 || displayName.length > 100)
    )
      throw new Error('invalid-fields');
    const password = await hiddenQuestion(
      'Nouveau mot de passe (12–128 caractères, saisie masquée) : ',
    );
    const confirm = await hiddenQuestion('Confirmer le mot de passe : ');
    if (password.length < 12 || password.length > 128 || password !== confirm)
      throw new Error('invalid-password');
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2211919)`;
      if (update) {
        const owner = await tx.adminAccount.update({
          where: { username: currentUsername, role: 'owner', active: true },
          data: { username, passwordHash },
          select: { id: true },
        });
        await tx.adminSession.deleteMany({ where: { accountId: owner.id } });
      } else {
        if (await tx.adminAccount.count({ where: { role: 'owner' } }))
          throw new Error('owner-already-created');
        await tx.adminAccount.create({
          data: { username, displayName, passwordHash, role: 'owner' },
        });
      }
    });
    process.stdout.write(
      update
        ? 'Accès propriétaire mis à jour. Les anciennes sessions ont été fermées.\n'
        : 'Compte propriétaire créé. Aucun mot de passe n’a été affiché.\n',
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write(
    'Opération interrompue. Vérifiez la base migrée, les identifiants et la confirmation dans un terminal interactif.\n',
  );
  process.exitCode = 1;
});
