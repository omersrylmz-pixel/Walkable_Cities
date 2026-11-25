/** AI servisi `/v1/analyze` istemcisi: görselden ihlal skoru ve tespitler. */

import { z } from 'zod';

const detectionSchema = z.object({
  label: z.string(),
  classId: z.number().int(),
  confidence: z.number().min(0).max(1),
  box: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  overlapRatio: z.number().min(0).max(1),
  severity: z.number().int().min(1).max(5),
  violationType: z.string(),
});

const analyzeResponseSchema = z.object({
  requestId: z.string(),
  backend: z.enum(['onnx', 'heuristic']),
  deterministic: z.boolean(),
  models: z.array(
    z.object({
      role: z.enum(['detector', 'segmenter']),
      name: z.string(),
      version: z.string(),
      loaded: z.boolean(),
      path: z.string(),
      inputSize: z.number(),
      error: z.string().nullable().optional(),
    }),
  ),
  image: z.object({
    width: z.number(),
    height: z.number(),
    originalWidth: z.number(),
    originalHeight: z.number(),
    mimeType: z.string(),
    sha256: z.string(),
    byteSize: z.number(),
  }),
  detections: z.array(detectionSchema),
  segmentation: z.object({
    walkableAreaRatio: z.number(),
    sidewalkRatio: z.number(),
    crosswalkRatio: z.number(),
    obstacleRatio: z.number(),
  }),
  metrics: z.object({
    overlapRatio: z.number(),
    obstructionRatio: z.number(),
    topConfidence: z.number(),
    detectionCount: z.number(),
  }),
  score: z.object({
    raw: z.number(),
    calibrated: z.number(),
    temperature: z.number(),
  }),
  decision: z.object({
    outcome: z.enum(['auto_accept', 'manual_review', 'auto_reject']),
    status: z.enum(['auto_approved', 'pending_review', 'auto_rejected']),
    reason: z.string(),
    thresholds: z.object({
      autoAccept: z.number(),
      manualReview: z.number(),
    }),
  }),
  latency: z.object({
    preprocessMs: z.number(),
    detectorMs: z.number(),
    segmenterMs: z.number(),
    postprocessMs: z.number(),
    totalMs: z.number(),
  }),
  modelVersion: z.string(),
  analyzedAt: z.string(),
});

export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;

export interface AnalysisInput {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  requestId?: string;
}

export interface AnalysisResult {
  requestId: string;
  backend: 'onnx' | 'heuristic';
  modelVersion: string;
  detectorName: string;
  segmenterName: string | null;
  score: number;
  outcome: 'auto_accept' | 'manual_review' | 'auto_reject';
  status: 'auto_approved' | 'pending_review' | 'auto_rejected';
  reason: string;
  thresholds: { autoAccept: number; manualReview: number };
  detections: AnalyzeResponse['detections'];
  metrics: AnalyzeResponse['metrics'];
  segmentation: AnalyzeResponse['segmentation'];
  latencyMs: number;
  analyzedAt: string;
}

/** Testlerde sahte analizci enjekte etmek için sözleşme. */
export interface Analyzer {
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}

export class AnalysisClientError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = 'AnalysisClientError';
  }
}

const ANALYZE_PATH = '/v1/analyze';

export class AnalysisClient implements Analyzer {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const form = new FormData();
    const bytes = new Uint8Array(input.buffer);
    form.append(
      'image',
      new Blob([bytes], { type: input.mimeType }),
      input.filename ?? 'report-image',
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/u, '')}${ANALYZE_PATH}`, {
        method: 'POST',
        body: form,
        headers: input.requestId ? { 'x-request-id': input.requestId } : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AnalysisClientError(`AI servisine ulaşılamadı: ${reason}`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AnalysisClientError(
        `AI analizi başarısız (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
        response.status,
      );
    }

    const parsed = analyzeResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new AnalysisClientError(
        `AI yanıtı beklenen sözleşmeye uymuyor: ${parsed.error.issues[0]?.message ?? 'bilinmeyen alan'}`,
      );
    }

    return toResult(parsed.data);
  }
}

function toResult(body: AnalyzeResponse): AnalysisResult {
  const detector = body.models.find((model) => model.role === 'detector');
  const segmenter = body.models.find((model) => model.role === 'segmenter');

  return {
    requestId: body.requestId,
    backend: body.backend,
    modelVersion: body.modelVersion,
    detectorName: detector?.name ?? body.backend,
    segmenterName: segmenter?.name ?? null,
    score: clamp01(body.score.calibrated),
    outcome: body.decision.outcome,
    status: body.decision.status,
    reason: body.decision.reason,
    thresholds: body.decision.thresholds,
    detections: body.detections,
    metrics: body.metrics,
    segmentation: body.segmentation,
    latencyMs: Math.round(body.latency.totalMs),
    analyzedAt: body.analyzedAt,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
