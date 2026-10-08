import { Equals, IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class CreateContactDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @Transform(trim)
  @IsString()
  @Matches(/^[+\d\s().-]{7,25}$/)
  phone!: string;
  @IsIn(['collection', 'personnalisation', 'partenariat', 'autre'])
  subject!: string;
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;
  @Equals(true)
  consent!: boolean;
  // Honeypot obligatoire : tout contenu est rejeté, sans fausse confirmation.
  @IsString()
  @MaxLength(0)
  website!: string;
}
