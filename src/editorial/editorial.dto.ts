import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const ARTICLE_CATEGORIES = ['actualites', 'interviews', 'reportages', 'analyses'] as const;
export class ArticleDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @Transform(trim) @IsString() @MaxLength(400) excerpt = '';
  @IsString() body!: string;
  @IsIn(ARTICLE_CATEGORIES) category!: string;
  @Transform(trim) @IsString() @MaxLength(100) author = '';
  @IsIn(['draft', 'published']) status!: string;
  @ValidateIf((_o, v: unknown) => v !== undefined) @IsBoolean() featured?: boolean;
  @ValidateIf((_o, v: unknown) => v !== undefined) @IsInt() @Min(1) version?: number;
}
export class ArticleImageDto {
  @Transform(trim) @IsString() @MaxLength(200) alt = '';
  @Transform(trim) @IsString() @MaxLength(300) caption = '';
  @Transform(trim) @IsString() @MaxLength(100) credit = '';
}
export class ArticleQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(24) pageSize = 12;
  @ValidateIf((_o, v: unknown) => v !== undefined) @IsIn(ARTICLE_CATEGORIES) category?: string;
  @ValidateIf((_o, v: unknown) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;
  @ValidateIf((_o, v: unknown) => v !== undefined) @IsIn(['draft', 'published']) status?: string;
}
