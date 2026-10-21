import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsIn,
  Max,
  Min,
  ValidateIf,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
export class CustomerLoginDto {
  @Transform(email) @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class RegisterCustomerDto {
  @Transform(email) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[^<>\p{Cc}]+$/u)
  displayName!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsBoolean() @Equals(true) consent!: boolean;
}
export class CustomerPasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
export class CustomerForgotDto {
  @Transform(email) @IsEmail() @MaxLength(254) email!: string;
}
export class CustomerTokenDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
}
export class CustomerResetDto extends CustomerTokenDto {
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
export class CustomerRequestStatusDto {
  @IsIn(['received', 'shipped', 'delivered', 'cancelled']) status!:
    'received' | 'shipped' | 'delivered' | 'cancelled';
  @IsInt() @Min(0) version!: number;
  @IsBoolean() @Equals(true) confirmed!: boolean;
}
export class CustomerProfileDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[^<>\p{Cc}]+$/u)
  displayName!: string;
}
export class DeleteCustomerDto {
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class MergeWishlistDto {
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('4', { each: true }) productIds!: string[];
}
export class RecordProductViewDto {
  @IsUUID('4') productId!: string;
}
export class CustomerHistorySettingsDto {
  @IsBoolean() enabled!: boolean;
}

export class CustomerPreparedRequestDto {
  @IsUUID('4') productId!: string;
  @IsUUID('4') requestKey!: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  size?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  color?: string;
}
