import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { AppError } from '../shared/errors.js';

/** RFC 7807 Problem Details gövdesi + uygulamaya özgü alanlar. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  traceId: string;
  errors?: { path: string; message: string }[];
}

const ERROR_BASE = 'https://yaya-platform.local/errors';

/** Fastify'nin kendi hata kodlarını uygulama kodlarına eşler. */
function mapFastifyError(error: FastifyError): { status: number; code: string; message: string } {
  const status = error.statusCode ?? 500;

  switch (status) {
    case 400:
      return { status, code: 'BAD_REQUEST', message: error.message };
    case 404:
      return { status, code: 'NOT_FOUND', message: error.message };
    case 413:
      return { status, code: 'PAYLOAD_TOO_LARGE', message: 'Yüklenen dosya izin verilen boyutu aşıyor' };
    case 415:
      return { status, code: 'UNSUPPORTED_MEDIA_TYPE', message: error.message };
    case 429:
      return { status, code: 'RATE_LIMITED', message: 'Çok fazla istek gönderildi' };
    default:
      return { status, code: error.code ?? 'INTERNAL_ERROR', message: error.message };
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | AppError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
      let problem: ProblemDetails;

      if (error instanceof AppError) {
        problem = {
          type: `${ERROR_BASE}/${error.code}`,
          title: httpTitle(error.statusCode),
          status: error.statusCode,
          code: error.code,
          detail: error.message,
          instance: request.url,
          traceId: request.id,
          errors: error.details,
        };
      } else if (error instanceof ZodError) {
        problem = {
          type: `${ERROR_BASE}/VALIDATION_ERROR`,
          title: httpTitle(422),
          status: 422,
          code: 'VALIDATION_ERROR',
          detail: 'İstek doğrulanamadı',
          instance: request.url,
          traceId: request.id,
          errors: error.issues.map((issue) => ({
            path: issue.path.join('.') || '(kök)',
            message: issue.message,
          })),
        };
      } else {
        const mapped = mapFastifyError(error);
        const isServerError = mapped.status >= 500;

        if (isServerError) {
          request.log.error({ err: error }, 'Beklenmeyen sunucu hatası');
        } else {
          request.log.warn({ err: error }, 'İstek reddedildi');
        }

        problem = {
          type: `${ERROR_BASE}/${mapped.code}`,
          title: httpTitle(mapped.status),
          status: mapped.status,
          code: mapped.code,
          // Sunucu hatalarında iç ayrıntıyı sızdırma.
          detail: isServerError ? 'Beklenmeyen bir sunucu hatası oluştu' : mapped.message,
          instance: request.url,
          traceId: request.id,
        };
      }

      void reply
        .code(problem.status)
        .type('application/problem+json')
        .header('x-request-id', request.id)
        .send(problem);
    },
  );

  app.setNotFoundHandler((request, reply) => {
    const problem: ProblemDetails = {
      type: `${ERROR_BASE}/NOT_FOUND`,
      title: httpTitle(404),
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      detail: `Uç bulunamadı: ${request.method} ${request.url}`,
      instance: request.url,
      traceId: request.id,
    };

    void reply.code(404).type('application/problem+json').send(problem);
  });
}

function httpTitle(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request';
    case 404:
      return 'Not Found';
    case 413:
      return 'Payload Too Large';
    case 415:
      return 'Unsupported Media Type';
    case 422:
      return 'Unprocessable Entity';
    case 429:
      return 'Too Many Requests';
    case 502:
      return 'Bad Gateway';
    case 503:
      return 'Service Unavailable';
    default:
      return status >= 500 ? 'Internal Server Error' : 'Error';
  }
}
