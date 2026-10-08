import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { CreateContactDto } from './create-contact.dto';
import { ContactSubject } from '../generated/prisma/enums';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);
  constructor(private readonly db: DatabaseService) {}
  async create(dto: CreateContactDto, requestKey?: string) {
    const id = requestKey || randomUUID();
    try {
      await this.db.contactRequest.create({
        data: {
          id,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          subject: dto.subject as ContactSubject,
          message: dto.message,
          consentAt: new Date(),
        },
        select: { id: true },
      });
    } catch (error) {
      // Une réponse réseau perdue ne doit pas créer une deuxième demande lors du retry.
      if (
        requestKey &&
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        let previous;
        try {
          previous = await this.db.contactRequest.findUnique({
            where: { id },
            select: { name: true, email: true, phone: true, subject: true, message: true },
          });
        } catch {
          throw new ServiceUnavailableException('La confirmation est momentanément indisponible.');
        }
        if (
          previous &&
          previous.name === dto.name &&
          previous.email === dto.email &&
          previous.phone === dto.phone &&
          previous.subject === dto.subject &&
          previous.message === dto.message
        ) {
          return {
            reference: id,
            message: 'Votre demande a été enregistrée. Conservez sa référence.',
          };
        }
        throw new ConflictException(
          'Cette référence correspond à une autre demande. Rechargez le formulaire.',
        );
      }
      this.logger.error('Enregistrement de contact indisponible.');
      throw new ServiceUnavailableException(
        'Votre message n’a pas pu être enregistré. Réessayez ou contactez-nous par WhatsApp.',
      );
    }
    return { reference: id, message: 'Votre demande a été enregistrée. Conservez sa référence.' };
  }
}
