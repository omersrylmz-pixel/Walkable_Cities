import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS, statusTone } from '@/lib/format';
import type { ReportStatus } from '@/lib/types';

export function StatusBadge({ status }: { status: ReportStatus }) {
  return <Badge variant={statusTone(status)}>{STATUS_LABELS[status]}</Badge>;
}
