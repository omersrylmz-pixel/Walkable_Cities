export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * HTTP katmanına taşınacak uygulama hataları.
 * RFC 7807 (Problem Details) yanıtına dönüştürülür.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function unprocessable(message: string, details?: ErrorDetail[]): AppError {
  return new AppError(422, 'VALIDATION_ERROR', message, details);
}

export function badRequest(message: string, code = 'BAD_REQUEST'): AppError {
  return new AppError(400, code, message);
}

export function notFound(message = 'Kayıt bulunamadı'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function unsupportedMedia(message: string): AppError {
  return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
}

export function payloadTooLarge(message: string): AppError {
  return new AppError(413, 'PAYLOAD_TOO_LARGE', message);
}

export function serviceUnavailable(message: string): AppError {
  return new AppError(503, 'SERVICE_UNAVAILABLE', message);
}
