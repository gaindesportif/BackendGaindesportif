import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './create-contact.dto';
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  create(
    @Body() dto: CreateContactDto,
    @Headers('idempotency-key')
    requestKey?: string,
  ) {
    if (requestKey && !isUUID(requestKey, '4'))
      throw new BadRequestException('Référence invalide.');
    return this.contacts.create(dto, requestKey?.toLowerCase());
  }
}
