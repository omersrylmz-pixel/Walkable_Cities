'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ApiError, applyDecision } from '@/lib/api-client';
import { requireReviewer } from '@/lib/auth/server';
import type { ManualDecision } from '@/lib/types';

export interface DecisionState {
  error?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function submitDecision(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const user = await requireReviewer();

  const reportId = String(formData.get('reportId') ?? '');
  if (!UUID_PATTERN.test(reportId)) {
    return { error: 'Geçersiz ihbar kimliği.' };
  }

  const rawDecision = formData.get('decision');
  if (rawDecision !== 'manual_accept' && rawDecision !== 'manual_reject') {
    return { error: 'Lütfen kabul veya ret kararından birini seçin.' };
  }
  const decision: ManualDecision = rawDecision;

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 1000) {
    return { error: 'Gerekçe en fazla 1000 karakter olabilir.' };
  }

  const override = formData.get('override') === 'on';

  try {
    await applyDecision(reportId, {
      decision,
      note: note || undefined,
      actorId: user.sub,
      override,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const details = error.details.map((detail) => detail.message).join(' ');
      return { error: details ? `${error.message} (${details})` : error.message };
    }
    return { error: 'Karar kaydedilemedi. Lütfen tekrar deneyin.' };
  }

  revalidatePath(`/review/${reportId}`);
  revalidatePath('/review');
  revalidatePath('/dashboard');
  redirect(`/review/${reportId}?ok=1`);
}
