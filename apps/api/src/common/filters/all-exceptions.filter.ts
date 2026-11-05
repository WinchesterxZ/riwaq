import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppException } from '../errors';

/**
 * Renders the standard bilingual error envelope:
 * { code, message, message_ar, details, correlation_id }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const correlationId = req.correlationId ?? 'req_unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let messageAr = 'حدث خطأ غير متوقع.';
    let details: unknown = null;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      messageAr = exception.messageAr;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = typeof b.message === 'string' ? b.message : Array.isArray(b.message) ? b.message.join('; ') : message;
        details = b;
      } else if (typeof body === 'string') {
        message = body;
      }
      code = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
      messageAr = this.arabicFor(status);
    }

    if (status >= 500) {
      this.logger.error(`[${correlationId}] ${req.method} ${req.url}`, exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      code,
      message,
      message_ar: messageAr,
      details,
      correlation_id: correlationId,
    });
  }

  private arabicFor(status: number): string {
    switch (status) {
      case 400: return 'طلب غير صالح.';
      case 401: return 'غير مسجّل الدخول.';
      case 403: return 'ممنوع.';
      case 404: return 'غير موجود.';
      case 409: return 'تعارض في البيانات.';
      case 422: return 'بيانات غير صالحة.';
      case 429: return 'محاولات كثيرة جدًا. حاول لاحقًا.';
      default: return 'حدث خطأ غير متوقع.';
    }
  }
}
