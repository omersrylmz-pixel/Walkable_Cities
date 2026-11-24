'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DecisionOutcome } from '@/lib/types';

import { submitDecision, type DecisionState } from './actions';

const initialState: DecisionState = {};

export function DecisionForm({
  reportId,
  currentDecision,
}: {
  reportId: string;
  currentDecision: DecisionOutcome | null;
}) {
  const [state, formAction, pending] = useActionState(submitDecision, initialState);
  const alreadyDecided = currentDecision === 'manual_accept' || currentDecision === 'manual_reject';

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="reportId" value={reportId} />

      {alreadyDecided ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Bu ihbar için daha önce manuel karar verilmiş. Kararı değiştirmek için aşağıdaki
          onay kutusunu işaretlemeniz gerekir.
        </div>
      ) : null}

      {state.error ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Karar</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input
              type="radio"
              name="decision"
              value="manual_accept"
              required
              defaultChecked={currentDecision === 'manual_accept'}
              className="mt-1 h-4 w-4 accent-emerald-600"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                Kabul et
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                İhbar geçerli; saha müdahalesi planlanır.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted has-[:checked]:border-red-500 has-[:checked]:bg-red-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input
              type="radio"
              name="decision"
              value="manual_reject"
              required
              defaultChecked={currentDecision === 'manual_reject'}
              className="mt-1 h-4 w-4 accent-red-600"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <XCircle aria-hidden="true" className="h-4 w-4 text-red-600" />
                Reddet
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                İhbar geçersiz veya yaya alanı ihlali değil.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="note">Gerekçe (opsiyonel)</Label>
        <Textarea
          id="note"
          name="note"
          maxLength={1000}
          placeholder="Kararın gerekçesini kısaca açıklayın. Bu metin denetim kaydına yazılır."
          aria-describedby="note-help"
        />
        <p id="note-help" className="text-xs text-muted-foreground">
          En fazla 1000 karakter. Gerekçe değiştirilemez denetim izine kaydedilir.
        </p>
      </div>

      {alreadyDecided ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="override" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
          <span>
            Mevcut kararı geçersiz kıl
            <span className="block text-xs text-muted-foreground">
              Bu işlem denetim kaydına ayrıca yazılır.
            </span>
          </span>
        </label>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
        {pending ? 'Kaydediliyor…' : 'Kararı kaydet'}
      </Button>
    </form>
  );
}
