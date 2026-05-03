import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ApiError, ApiErrorCode } from '@abd/shared';
import { ZodError } from 'zod';

export default fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.httpStatus).send(err.toBody());
    }

    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: ApiErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: err.format(),
      });
    }

    // fastify ValidationError
    const errWithStatus = err as Error & { statusCode?: number };
    if (errWithStatus.statusCode === 400) {
      return reply.code(400).send({
        code: ApiErrorCode.VALIDATION_ERROR,
        message: errWithStatus.message,
      });
    }

    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({
      code: ApiErrorCode.INTERNAL,
      message: 'Internal server error',
    });
  });
});
