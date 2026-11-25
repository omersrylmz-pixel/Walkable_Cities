import type {
  AnalyticsRange,
  AnalyticsResolution,
  ApplyDecisionResult,
  AuditPage,
  DecisionThresholds,
  H3Analytics,
  ListReportsQuery,
  ManualDecision,
  MediaKind,
  Pagination,
  PrivacySettings,
  ReportDto,
  ReportSummaryDto,
  ReviewQueueQuery,
  ReviewQueueResponse,
  SettingsMutationResult,
  SystemAuditEntry,
  SystemAuditPage,
  SystemSettings,
  ViolationTypeMeta,
} from './types';

/**
 * Panel yalnızca sunucu tarafından API'ye bağlanır; tarayıcı CORS ile uğraşmaz.
 * Docker/Compose içinde `API_INTERNAL_URL=http://api:3000` kullanılabilir.
 */
const API_URL = (
  process.env.API_INTERNAL_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3001'
).replace(/\/+$/u, '');

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  data: T;
}

interface ListEnvelopeWithPagination<T> extends Envelope<T[]> {
  pagination: Pagination;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const envelope = await requestEnvelope<T>(path, init);
  return envelope.data;
}

async function requestEnvelope<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  return requestJson<Envelope<T>>(path, init);
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'bilinmeyen hata';
    throw new ApiError(
      503,
      'API_UNAVAILABLE',
      `API servisine ulaşılamadı (${API_URL}). Servisin çalıştığını kontrol edin. Ayrıntı: ${reason}`,
    );
  }

  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let message = `API isteği başarısız oldu (HTTP ${response.status})`;
    let details: ApiErrorDetail[] = [];

    try {
      const problem = (await response.json()) as {
        code?: string;
        detail?: string;
        errors?: ApiErrorDetail[];
      };
      code = problem.code ?? code;
      message = problem.detail ?? message;
      details = problem.errors ?? [];
    } catch {
      // Gövde JSON değilse varsayılan mesaj kullanılır.
    }

    throw new ApiError(response.status, code, message, details);
  }

  return (await response.json()) as T;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function getApiBaseUrl(): string {
  return API_URL;
}

/** API'nin yönetici uçları için panel oturumundaki kullanıcıyı taşır. */
function actorHeader(actorId: string): Record<string, string> {
  return { 'x-actor-id': actorId };
}

export async function getMeta(): Promise<{
  violationTypes: ViolationTypeMeta[];
  thresholds: DecisionThresholds;
}> {
  return request('/v1/meta');
}

export async function getSettings(actorId: string): Promise<SystemSettings> {
  return request('/v1/settings', { headers: actorHeader(actorId) });
}

export async function updateThresholds(
  actorId: string,
  input: { autoAccept: number; manualReview: number },
): Promise<SettingsMutationResult> {
  return request('/v1/settings/thresholds', {
    method: 'PATCH',
    headers: actorHeader(actorId),
    body: JSON.stringify(input),
  });
}

export async function updatePrivacy(
  actorId: string,
  input: PrivacySettings,
): Promise<SettingsMutationResult> {
  return request('/v1/settings/privacy', {
    method: 'PATCH',
    headers: actorHeader(actorId),
    body: JSON.stringify(input),
  });
}

export async function getSystemAudit(
  actorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<SystemAuditPage> {
  const envelope = await requestJson<ListEnvelopeWithPagination<SystemAuditEntry>>(
    `/v1/settings/audit${toQuery({
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    })}`,
    { headers: actorHeader(actorId) },
  );

  return {
    items: envelope.data,
    total: envelope.pagination.total,
    limit: envelope.pagination.limit,
    offset: envelope.pagination.offset,
  };
}

export async function getH3Analytics(query: {
  resolution?: AnalyticsResolution;
  range?: AnalyticsRange;
  violationType?: ViolationTypeMeta['code'];
}): Promise<H3Analytics> {
  return request(
    `/v1/analytics/h3${toQuery({
      resolution: query.resolution,
      range: query.range,
      violationType: query.violationType,
    })}`,
  );
}

export async function listReports(
  query: ListReportsQuery = {},
): Promise<{ items: ReportSummaryDto[]; pagination: Pagination }> {
  const envelope = await requestJson<ListEnvelopeWithPagination<ReportSummaryDto>>(
    `/v1/reports${toQuery({
      status: query.status,
      violationType: query.violationType,
      sort: query.sort,
      minScore: query.minScore,
      maxScore: query.maxScore,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    })}`,
  );
  return { items: envelope.data, pagination: envelope.pagination };
}

export async function getReport(id: string): Promise<ReportDto> {
  return request(`/v1/reports/${encodeURIComponent(id)}`);
}

export async function getReviewQueue(query: ReviewQueueQuery = {}): Promise<ReviewQueueResponse> {
  const body = await requestJson<{
    data: ReportSummaryDto[];
    pagination: Pagination;
    thresholds: ReviewQueueResponse['thresholds'];
  }>(
    `/v1/review-queue${toQuery({
      violationType: query.violationType,
      minScore: query.minScore,
      maxScore: query.maxScore,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    })}`,
  );
  return {
    items: body.data,
    total: body.pagination.total,
    limit: body.pagination.limit,
    offset: body.pagination.offset,
    thresholds: body.thresholds,
  };
}

export async function getAudit(
  reportId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AuditPage> {
  const envelope = await requestJson<ListEnvelopeWithPagination<AuditPage['items'][number]>>(
    `/v1/reports/${encodeURIComponent(reportId)}/audit${toQuery({
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    })}`,
  );
  return {
    items: envelope.data,
    total: envelope.pagination.total,
    limit: envelope.pagination.limit,
    offset: envelope.pagination.offset,
  };
}

export async function applyDecision(
  reportId: string,
  input: { decision: ManualDecision; note?: string; actorId?: string; override?: boolean },
): Promise<ApplyDecisionResult> {
  return request(`/v1/reports/${encodeURIComponent(reportId)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Harita için sayfalı listeyi toplar. API tek istekte en çok 100 kayıt döndürür;
 * 10.000 nokta hedefi için üst sınır yapılandırılabilir (varsayılan 2.000).
 */
export async function getAllReportSummaries(maxRecords = 2_000): Promise<ReportSummaryDto[]> {
  const pageSize = 100;
  const maxPages = Math.max(1, Math.ceil(maxRecords / pageSize));

  const first = await listReports({ limit: pageSize, offset: 0, sort: 'recent' });
  const items = [...first.items];
  const pages = Math.min(maxPages, Math.ceil(first.pagination.total / pageSize));

  if (pages > 1) {
    const requests: Promise<{ items: ReportSummaryDto[]; pagination: Pagination }>[] = [];
    for (let page = 1; page < pages; page += 1) {
      requests.push(listReports({ limit: pageSize, offset: page * pageSize, sort: 'recent' }));
    }
    const results = await Promise.all(requests);
    for (const result of results) items.push(...result.items);
  }

  return items.slice(0, maxRecords);
}

/** Görsel proxy'si için API yanıtını olduğu gibi döndürür. */
export async function fetchReportImage(id: string, kind: MediaKind): Promise<Response> {
  return fetch(`${API_URL}/v1/reports/${encodeURIComponent(id)}/images/${kind}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
}
