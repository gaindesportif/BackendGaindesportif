import { ContactsService } from './contacts.service';
import { DatabaseService } from '../database/database.service';
import { ServiceUnavailableException } from '@nestjs/common';
const dto = {
  name: 'Test',
  email: 'test@example.com',
  phone: '+221770000000',
  subject: 'autre',
  message: 'Message de test',
  consent: true,
  website: '',
};
describe('ContactsService', () => {
  it('enregistre avec Prisma et retourne uniquement une référence', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'test' });
    const service = new ContactsService({
      contactRequest: { create },
    } as unknown as DatabaseService);
    const result = await service.create(dto);
    expect(result.reference).toMatch(/^[\da-f-]{36}$/);
    expect(create).toHaveBeenCalledWith({
      data: {
        id: result.reference,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        subject: dto.subject,
        message: dto.message,
        consentAt: expect.any(Date),
      },
      select: { id: true },
    });
    expect(result).not.toHaveProperty('email');
  });
  it('ne retourne ni succès ni détail de connexion si la base échoue', async () => {
    const create = jest.fn().mockRejectedValue(new Error('sensitive connection string'));
    const service = new ContactsService({
      contactRequest: { create },
    } as unknown as DatabaseService);
    await expect(service.create(dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('retourne la même référence pour un retry identique sans nouvelle ligne', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const findUnique = jest.fn().mockResolvedValue(dto);
    const service = new ContactsService({
      contactRequest: { create, findUnique },
    } as unknown as DatabaseService);
    const key = '11111111-1111-4111-8111-111111111111';
    expect((await service.create(dto, key)).reference).toBe(key);
    expect(findUnique).toHaveBeenCalled();
  });
  it('refuse de réutiliser une clé pour une autre demande sans révéler les données', async () => {
    const service = new ContactsService({
      contactRequest: {
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
        findUnique: jest.fn().mockResolvedValue({ ...dto, message: 'Autre demande' }),
      },
    } as unknown as DatabaseService);
    await expect(service.create(dto, '11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      'autre demande',
    );
  });
});
