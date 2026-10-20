import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class LoginDto {
  @Transform(trim) @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{2,59}$/) username!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class CreateAccountDto {
  @Transform(trim) @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{2,59}$/) username!: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) displayName!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
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
  @MinLength(12)
  @MaxLength(128)
  password?: string;
}
export class PasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
