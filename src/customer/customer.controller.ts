import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CustomerHistorySettingsDto,
  CustomerLoginDto,
  CustomerPasswordDto,
  CustomerPreparedRequestDto,
  CustomerProfileDto,
  CustomerForgotDto,
  CustomerResetDto,
  CustomerTokenDto,
  DeleteCustomerDto,
  MergeWishlistDto,
  RecordProductViewDto,
  RegisterCustomerDto,
} from './customer.dto';
import { CustomerGuard, type CustomerRequest } from './customer.guard';
import { CustomerService } from './customer.service';

@Controller('customer')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}
  @Get('config')
  config() {
    return this.customers.config();
  }
  @Post('auth/register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  register(@Body() dto: RegisterCustomerDto) {
    return this.customers.register(dto);
  }
  @Post('auth/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: CustomerLoginDto) {
    return this.customers.login(dto.email, dto.password);
  }
  @Get('auth/me')
  @UseGuards(CustomerGuard)
  me(@Req() request: CustomerRequest) {
    return { user: request.customer.user };
  }
  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  logout(@Req() request: CustomerRequest) {
    return this.customers.logout(request.customer);
  }
  @Post('auth/password')
  @HttpCode(200)
  @UseGuards(CustomerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  password(@Req() request: CustomerRequest, @Body() dto: CustomerPasswordDto) {
    return this.customers.changePassword(request.customer, dto.currentPassword, dto.newPassword);
  }
  @Post('auth/forgot')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  forgot(@Body() dto: CustomerForgotDto) {
    return this.customers.forgot(dto.email);
  }
  @Post('auth/reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() dto: CustomerResetDto) {
    return this.customers.resetPassword(dto.token, dto.newPassword);
  }
  @Post('auth/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  verify(@Body() dto: CustomerTokenDto) {
    return this.customers.verifyEmail(dto.token);
  }
  @Post('auth/resend-verification')
  @HttpCode(200)
  @UseGuards(CustomerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  resendVerification(@Req() req: CustomerRequest) {
    return this.customers.resendVerification(req.customer);
  }
  @Patch('profile')
  @UseGuards(CustomerGuard)
  profile(@Req() request: CustomerRequest, @Body() dto: CustomerProfileDto) {
    return this.customers.updateProfile(request.customer, dto.displayName);
  }
  @Delete('profile')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  deleteProfile(@Req() request: CustomerRequest, @Body() dto: DeleteCustomerDto) {
    return this.customers.deleteProfile(request.customer, dto.password);
  }
  @Get('wishlist')
  @UseGuards(CustomerGuard)
  wishlist(@Req() request: CustomerRequest) {
    return this.customers.wishlist(request.customer);
  }
  @Post('wishlist/merge')
  @HttpCode(200)
  @UseGuards(CustomerGuard)
  mergeWishlist(@Req() request: CustomerRequest, @Body() dto: MergeWishlistDto) {
    return this.customers.mergeWishlist(request.customer, dto.productIds);
  }
  @Put('wishlist/:productId')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  addWishlist(
    @Req() request: CustomerRequest,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.customers.addWishlist(request.customer, productId);
  }
  @Delete('wishlist/:productId')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  removeWishlist(
    @Req() request: CustomerRequest,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.customers.removeWishlist(request.customer, productId);
  }
  @Get('history')
  @UseGuards(CustomerGuard)
  history(@Req() request: CustomerRequest) {
    return this.customers.history(request.customer);
  }
  @Post('history')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  recordView(@Req() request: CustomerRequest, @Body() dto: RecordProductViewDto) {
    return this.customers.recordView(request.customer, dto.productId);
  }
  @Delete('history')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  clearHistory(@Req() request: CustomerRequest) {
    return this.customers.clearHistory(request.customer);
  }
  @Patch('history/settings')
  @UseGuards(CustomerGuard)
  historySettings(@Req() request: CustomerRequest, @Body() dto: CustomerHistorySettingsDto) {
    return this.customers.historySettings(request.customer, dto.enabled);
  }
  @Get('requests')
  @UseGuards(CustomerGuard)
  preparedRequests(@Req() request: CustomerRequest) {
    return this.customers.preparedRequests(request.customer);
  }
  @Post('requests')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  prepareRequest(@Req() request: CustomerRequest, @Body() dto: CustomerPreparedRequestDto) {
    return this.customers.prepareRequest(request.customer, dto);
  }
  @Delete('requests')
  @HttpCode(204)
  @UseGuards(CustomerGuard)
  clearPreparedRequests(@Req() request: CustomerRequest) {
    return this.customers.clearPreparedRequests(request.customer);
  }
}
