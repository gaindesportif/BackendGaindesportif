import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  CustomerPreparedRequestDto,
  CustomerResetDto,
  MergeWishlistDto,
  RegisterCustomerDto,
} from './customer.dto';

const valid = {
  email: '  CUSTOMER@EXAMPLE.TEST ',
  displayName: '  Client local  ',
  password: 'long-test-password-123',
  consent: true,
};
describe('Validation comptes clients', () => {
  it('normalise email/nom et exige consentement, mot de passe long et champs stricts', async () => {
    const dto = plainToInstance(RegisterCustomerDto, valid);
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(dto.email).toBe('customer@example.test');
    expect(dto.displayName).toBe('Client local');
    for (const change of [
      { consent: false },
      { consent: 'true' },
      { password: 'trop-court' },
      { password: 'x'.repeat(129) },
      { displayName: '<script>' },
      { displayName: 'x' },
      { email: 'invalid' },
      { role: 'owner' },
    ]) {
      expect(
        (
          await validate(plainToInstance(RegisterCustomerDto, { ...valid, ...change }), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
    }
  });
  it('borne la fusion aux références UUID uniques et ne reçoit aucun prix client', async () => {
    expect(
      await validate(plainToInstance(MergeWishlistDto, { productIds: [randomUUID()] })),
    ).toHaveLength(0);
    for (const productIds of [
      ['invalid'],
      Array.from({ length: 101 }, () => randomUUID()),
      ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000'],
      null,
    ]) {
      expect(
        (await validate(plainToInstance(MergeWishlistDto, { productIds }))).length,
      ).toBeGreaterThan(0);
    }
    const request = { productId: randomUUID(), requestKey: randomUUID(), quantity: 1 };
    expect(await validate(plainToInstance(CustomerPreparedRequestDto, request))).toHaveLength(0);
    for (const change of [
      { quantity: 0 },
      { quantity: 100 },
      { quantity: '2' },
      { size: null },
      { color: 'x'.repeat(41) },
      { priceXof: 1 },
    ]) {
      expect(
        (
          await validate(plainToInstance(CustomerPreparedRequestDto, { ...request, ...change }), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
    }
  });
  it('accepte seulement un jeton e-mail opaque de 256 bits', async () => {
    const body = {
      token: 'a'.repeat(43),
      newPassword: 'long-test-password-123',
    };
    expect(await validate(plainToInstance(CustomerResetDto, body))).toHaveLength(0);
    expect(
      (await validate(plainToInstance(CustomerResetDto, { ...body, token: '1234' }))).length,
    ).toBeGreaterThan(0);
  });
});
