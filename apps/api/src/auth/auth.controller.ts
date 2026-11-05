import { randomBytes } from 'node:crypto';
import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  Public, Authed, Secured, Idempotent,
} from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationQuerySchema } from '@atlas-erp/contracts';
import {
  firstRunSchema, loginSchema, changePasswordSchema,
  passwordResetRequestSchema, passwordResetConfirmSchema,
  mfaVerifySchema, mfaDisableSchema,
  invitationCreateSchema, invitationAcceptSchema,
} from '@atlas-erp/contracts';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      path: '/',
      ...(maxAge ? { maxAge } : {}),
    };
  }

  private setSessionCookies(res: Response, token: string, expiresAt: Date) {
    const maxAge = expiresAt.getTime() - Date.now();
    res.cookie('atlas_session', token, this.cookieOptions(maxAge));
    // CSRF double-submit token (readable by JS, sent back as header).
    res.cookie('atlas_csrf', randomBytes(24).toString('hex'), {
      httpOnly: false,
      sameSite: 'lax' as const,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      path: '/',
      maxAge,
    });
  }

  @Public()
  @Get('first-run/status')
  firstRunStatus() {
    return this.auth.isFirstRun().then((firstRun) => ({ firstRun }));
  }

  /** Public CSRF bootstrap for the first-run wizard (no session yet). */
  @Public()
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response) {
    const token = randomBytes(24).toString('hex');
    res.cookie('atlas_csrf', token, {
      httpOnly: false,
      sameSite: 'lax' as const,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      path: '/',
    });
    return { csrfToken: token };
  }

  @Public()
  @Post('first-run')
  async firstRun(
    @Body(new ZodValidationPipe(firstRunSchema)) body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.firstRun(body as never, req.ip);
    this.setSessionCookies(res, result.token, result.expiresAt);
    const { token: _t, ...rest } = result;
    return rest;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: never,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      body as never, req.ip, req.headers['user-agent'],
    );
    this.setSessionCookies(res, result.token, result.expiresAt);
    const { token: _t, ...rest } = result;
    return rest;
  }

  @Authed()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['atlas_session'];
    if (token) await this.auth.logout(token);
    res.clearCookie('atlas_session', { path: '/' });
    res.clearCookie('atlas_csrf', { path: '/' });
    return { ok: true };
  }

  @Authed()
  @Get('me')
  me(@Req() req: Request) {
    return this.auth.me(req.user!.id);
  }

  @Authed()
  @HttpCode(200)
  @Post('change-password')
  changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
    @Req() req: Request,
  ) {
    return this.auth.changePassword(
      req.user!.id, body.currentPassword, body.newPassword,
      req.cookies?.['atlas_session'],
    ).then(() => ({ ok: true }));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password-reset/request')
  requestReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: { email: string },
    @Req() req: Request,
  ) {
    return this.auth.requestPasswordReset(body.email, req.ip).then(() => ({ ok: true }));
  }

  @Public()
  @HttpCode(200)
  @Post('password-reset/confirm')
  confirmReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: { token: string; newPassword: string },
  ) {
    return this.auth.confirmPasswordReset(body.token, body.newPassword).then(() => ({ ok: true }));
  }

  @Authed()
  @Post('mfa/setup')
  mfaSetup(@Req() req: Request) {
    return this.auth.mfaSetup(req.user!.id);
  }

  @Authed()
  @HttpCode(200)
  @Post('mfa/verify')
  mfaVerify(
    @Body(new ZodValidationPipe(mfaVerifySchema)) body: { code: string },
    @Req() req: Request,
  ) {
    return this.auth.mfaVerify(req.user!.id, body.code);
  }

  @Authed()
  @HttpCode(200)
  @Post('mfa/disable')
  mfaDisable(
    @Body(new ZodValidationPipe(mfaDisableSchema)) body: { password: string },
    @Req() req: Request,
  ) {
    return this.auth.mfaDisable(req.user!.id, body.password).then(() => ({ ok: true }));
  }

  @Authed()
  @Get('sessions')
  sessions(@Req() req: Request) {
    return this.auth.listSessions(req.user!.id);
  }

  @Authed()
  @Delete('sessions/:id')
  revokeSession(@Param('id') id: string, @Req() req: Request) {
    return this.auth.revokeSession(req.user!.id, id, req.cookies?.['atlas_session'])
      .then(() => ({ ok: true }));
  }

  @Secured('user:manage')
  @Idempotent()
  @Post('invitations')
  createInvitation(
    @Body(new ZodValidationPipe(invitationCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.auth.createInvitation(
      body as never, req.orgContext!.organizationId, req.user!.id, req.ip,
    );
  }

  @Secured('user:manage')
  @Get('invitations')
  listInvitations(@Req() req: Request) {
    return this.auth.listInvitations(req.orgContext!.organizationId);
  }

  @Public()
  @Post('invitations/accept')
  async acceptInvitation(
    @Body(new ZodValidationPipe(invitationAcceptSchema)) body: never,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.acceptInvitation(body as never, req.ip);
    this.setSessionCookies(res, result.token, result.expiresAt);
    const { token: _t, ...rest } = result;
    return rest;
  }
}
