import { HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from '../errors';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const req: Record<string, unknown> = { correlationId: 'req_test123', method: 'GET', url: '/x' };
  const res: Record<string, unknown> = { status };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  };
  return { host: host as never, json, status };
}

describe('AllExceptionsFilter (error envelope)', () => {
  const filter = new AllExceptionsFilter();

  it('renders AppException as the bilingual envelope', () => {
    const { host, json, status } = mockHost();
    filter.catch(
      new AppException('INVALID_CREDENTIALS', 'Invalid email or password.', 'بيانات الدخول غير صحيحة.', HttpStatus.UNAUTHORIZED),
      host,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
      message_ar: 'بيانات الدخول غير صحيحة.',
      details: null,
      correlation_id: 'req_test123',
    });
  });

  it('masks unexpected errors as INTERNAL_ERROR without leaking internals', () => {
    const { host, json, status } = mockHost();
    filter.catch(new Error('db password is hunter2'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body.correlation_id).toBe('req_test123');
  });
});
