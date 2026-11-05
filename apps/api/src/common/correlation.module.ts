import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';

function correlationMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.correlationId = `req_${randomBytes(8).toString('hex')}`;
  next();
}

@Module({})
export class CorrelationModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(correlationMiddleware).forRoutes('*');
  }
}
