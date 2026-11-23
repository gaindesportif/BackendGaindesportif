import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { adminPasswordMinLength } from './password';

export const newAdminUsernamePattern = /^[^\p{Cc}]{4,60}$/u;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class LoginDto {
  @Transform(trim) @IsString() @Matches(/^[^\p{Cc}]{3,60}$/u) username!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class CreateAccountDto {
  @Transform(trim)
  @IsString()
  @Matches(newAdminUsernamePattern, {
    message: 'L’identifiant doit contenir de 4 à 60 caractères imprimables.',
  })
  username!: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) displayName!: string;
  @IsString() @MinLength(adminPasswordMinLength) @MaxLength(128) password!: string;
}
export class UpdateAccountDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsBoolean() active?: boolean;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(adminPasswordMinLength)
  @MaxLength(128)
  password?: string;
}
export class PasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(adminPasswordMinLength) @MaxLength(128) newPassword!: string;
}
