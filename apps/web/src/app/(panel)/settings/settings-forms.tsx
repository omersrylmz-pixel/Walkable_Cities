'use client';

import { AlarmClock, CheckCircle2, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SystemSettings } from '@/lib/types';

import { savePrivacy, saveThresholds, type SettingsState } from './actions';

const initialState: SettingsState = {};

function StatusMessage({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {state.error}
      </div>
    );
  }
  if (state.success) {
    return (
      <div
        role="status"
        className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
      >
        {state.success}
      </div>
    );
  }
  return null;
}

export function ThresholdForm({ settings }: { settings: SystemSettings }) {
  const [state, formAction, pending] = useActionState(saveThresholds, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Güven skoru bu sınırların üstündeyse ihbar otomatik kabul edilir; orta bant manuel
        inceleme kuyruğuna düşer. Değişiklik yalnızca bundan sonraki kararları etkiler.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="autoAccept">Otomatik kabul eşiği (≥)</Label>
          <Input
            id="autoAccept"
            name="autoAccept"
            type="number"
            min={0}
            max={1}
            step={0.01}
            inputMode="decimal"
            defaultValue={settings.thresholds.autoAccept}
            required
          />
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
            Şu an {settings.thresholds.autoAccept.toFixed(2)}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="manualReview">Manuel inceleme eşiği (≥)</Label>
          <Input
            id="manualReview"
            name="manualReview"
            type="number"
            min={0}
            max={1}
            step={0.01}
            inputMode="decimal"
            defaultValue={settings.thresholds.manualReview}
            required
          />
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <AlarmClock aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />
            Bu değerin altı otomatik ret bandıdır
          </p>
        </div>
      </div>

      <StatusMessage state={state} />

      <Button type="submit" disabled={pending} size="sm">
        {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
        {pending ? 'Kaydediliyor…' : 'Eşikleri kaydet'}
      </Button>
    </form>
  );
}

export function PrivacyForm({ settings }: { settings: SystemSettings }) {
  const [state, formAction, pending] = useActionState(savePrivacy, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Saklama süresi dolan ihbar görselleri temizlik görevi tarafından silinir. Anonimleştirme
        zorunluluğu açıkken yüz/plaka bulanıklaştırması başarısız olursa ihbar kabul edilmez.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="retentionDays">Görsel saklama süresi (gün)</Label>
          <Input
            id="retentionDays"
            name="retentionDays"
            type="number"
            min={30}
            max={3650}
            step={1}
            inputMode="numeric"
            defaultValue={settings.privacy.retentionDays}
            required
          />
          <p className="text-xs text-muted-foreground">
            Şu an {settings.privacy.retentionDays} gün · aralık 30–3650
          </p>
        </div>

        <div className="flex items-start gap-3 pt-1">
          <input
            id="anonymizationRequired"
            name="anonymizationRequired"
            type="checkbox"
            defaultChecked={settings.privacy.anonymizationRequired}
            className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <label htmlFor="anonymizationRequired" className="text-sm">
            Anonimleştirme zorunlu
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Kapalıysa anonimleştirme başarısız olsa bile ihbar kaydedilir ve
              <code className="mx-1 rounded bg-muted px-1">integrity.anonymization</code>
              alanında <code className="rounded bg-muted px-1">failed</code> olarak işaretlenir.
            </span>
          </label>
        </div>
      </div>

      <StatusMessage state={state} />

      <Button type="submit" disabled={pending} size="sm" variant="secondary">
        {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
        {pending ? 'Kaydediliyor…' : (
          <>
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            KVKK politikasını kaydet
          </>
        )}
      </Button>
    </form>
  );
}
