import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard, type AdminRequest } from './admin.guard';
import { AdminService } from './admin.service';
import { CreateAccountDto, LoginDto, PasswordDto, UpdateAccountDto } from './admin.dto';
@Controller('admin')
export class AdminController {
  constructor(private readonly admins: AdminService) {}
  @Post('auth/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: LoginDto) {
    return this.admins.login(dto.username, dto.password);
  }
  @Get('auth/me')
  @UseGuards(AdminGuard)
  me(@Req() req: AdminRequest) {
    return { user: req.admin.user };
  }
  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  logout(@Req() req: AdminRequest) {
    return this.admins.logout(req.admin.sessionId);
  }
  @Post('auth/password')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async password(@Req() req: AdminRequest, @Body() dto: PasswordDto) {
    await this.admins.changePassword(req.admin, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
  @Get('accounts')
  @UseGuards(AdminGuard)
  async accounts(@Req() req: AdminRequest) {
    return { items: await this.admins.listAccounts(req.admin) };
  }
  @Post('accounts')
  @UseGuards(AdminGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  create(@Req() req: AdminRequest, @Body() dto: CreateAccountDto) {
    return this.admins.createAccount(req.admin, dto);
  }
  @Patch('accounts/:id')
  @UseGuards(AdminGuard)
  update(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.admins.updateAccount(req.admin, id, dto);
  }
}
