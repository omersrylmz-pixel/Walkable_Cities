'use server';

import { revalidatePath } from 'next/cache';

import { ApiError, updatePrivacy, updateThresholds } from '@/lib/api-client';
import { requireAdmin } from '@/lib/auth/server';

export interface SettingsState {
  success?: string;
  error?: string;
}

function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const details = error.details.map((detail) => detail.message).join(' ');
    return details ? `${error.message} (${details})` : error.message;
  }
  return fallback;
}

function parseNumber(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').replace(',', '.').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function saveThresholds(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireAdmin('/settings');

  const autoAccept = parseNumber(formData, 'autoAccept');
  const manualReview = parseNumber(formData, 'manualReview');

  if (autoAccept === null || manualReview === null) {
    return { error: 'Her iki eşik değeri de sayısal olmalıdır (0–1 arası).' };
  }
  if (autoAccept < 0 || autoAccept > 1 || manualReview < 0 || manualReview > 1) {
    return { error: 'Eşikler 0 ile 1 arasında olmalıdır.' };
  }
  if (manualReview > autoAccept) {
    return { error: 'Manuel inceleme eşiği otomatik kabul eşiğinden büyük olamaz.' };
  }

  try {
    await updateThresholds(user.sub, { autoAccept, manualReview });
  } catch (error) {
    return { error: messageFrom(error, 'Eşikler kaydedilemedi. Lütfen tekrar deneyin.') };
  }

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/review');
  return { success: 'Karar eşikleri güncellendi; yeni kararlarda anında geçerli.' };
}

export async function savePrivacy(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireAdmin('/settings');

  const retentionDays = parseNumber(formData, 'retentionDays');
  if (retentionDays === null || !Number.isInteger(retentionDays)) {
    return { error: 'Saklama süresi tam sayı gün olarak girilmelidir.' };
  }
  if (retentionDays < 30 || retentionDays > 3650) {
    return { error: 'Saklama süresi 30–3650 gün aralığında olmalıdır.' };
  }

  const anonymizationRequired = formData.get('anonymizationRequired') === 'on';

  try {
    await updatePrivacy(user.sub, { retentionDays, anonymizationRequired });
  } catch (error) {
    return { error: messageFrom(error, 'KVKK ayarları kaydedilemedi. Lütfen tekrar deneyin.') };
  }

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return {
    success:
      'KVKK politikası güncellendi. Yeni ihbarlar bu saklama süresi ve anonimleştirme kuralıyla işlenir.',
  };
}
