import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AppPresenceService } from '../app-presence/app-presence.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { MarkPwaInstalledDto } from './dto/mark-pwa-installed.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendPhoneCodeDto } from './dto/send-phone-code.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly appPresence: AppPresenceService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('phone/send-code')
  sendPhoneCode(@Body() dto: SendPhoneCodeDto) {
    return this.authService.sendPhoneCode(dto.phone, dto.purpose);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub);
  }

  @Post('pwa-installed')
  @UseGuards(JwtAuthGuard)
  markPwaInstalled(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkPwaInstalledDto,
  ) {
    return this.authService.markPwaInstalled(user.sub, dto.installed);
  }

  /** Lightweight staff presence ping (throttled server-side). Clients ignored. */
  @Post('presence')
  @UseGuards(JwtAuthGuard)
  presence(@CurrentUser() user: JwtPayload) {
    return this.appPresence.touch(
      user.sub,
      user.roles.map((r) => String(r)),
    );
  }
}
