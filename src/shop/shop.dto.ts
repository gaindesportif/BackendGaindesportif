import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const categories = [
  'senegal',
  'dakar',
  'accessoires',
  'equipements',
  'personnalisation',
  'merchandising',
];
export class ProductDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @Transform(trim) @IsString() @MaxLength(5000) description!: string;
  @IsIn(categories) category!: string;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) priceXof?: number | null;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  sizes?: string[];
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  colors?: string[];
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['on_request', 'available', 'unavailable'])
  availability?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
}
export class PatchProductDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsIn(categories) category?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) priceXof?: number | null;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  sizes?: string[];
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  colors?: string[];
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['on_request', 'available', 'unavailable'])
  availability?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
}
export class ListProductsDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 24;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsIn(categories) category?: string;
}
export class UploadSignatureDto {
  @IsIn(['image', 'video']) type!: 'image' | 'video';
}
export class ConfirmMediaDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  alt?: string;
}
export class PatchMediaDto extends ConfirmMediaDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  position?: number;
}
