import { describe, expect, it } from 'vitest';

import { firstParam, parseReportFilters, pickOffset, pickScore } from './report-filters';

function fromValues(values: Record<string, string>) {
  return (key: string): string | undefined => values[key];
}

describe('İhbar filtreleri', () => {
  it('geçerli değerleri API sorgusuna çevirir', () => {
    const filters = parseReportFilters(
      fromValues({
        status: 'approved',
        violationType: 'kaldirim_isgali',
        sort: 'score',
        minScore: '0,75',
        maxScore: '1',
      }),
    );

    expect(filters).toEqual({
      status: 'approved',
      violationType: 'kaldirim_isgali',
      sort: 'score',
      minScore: 0.75,
      maxScore: 1,
    });
  });

  it('geçersiz değerleri yok sayar ve sıralamayı en yeniye çeker', () => {
    const filters = parseReportFilters(
      fromValues({
        status: 'bilinmeyen',
        violationType: 'x',
        sort: 'abc',
        minScore: '2',
        maxScore: '-1',
      }),
    );

    expect(filters).toEqual({
      status: undefined,
      violationType: undefined,
      sort: 'recent',
      minScore: undefined,
      maxScore: undefined,
    });
  });

  it('ilk parametreyi ve geçerli offseti seçer', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam(undefined)).toBeUndefined();
    expect(pickOffset('-3')).toBe(0);
    expect(pickOffset('40')).toBe(40);
    expect(pickScore('0,85')).toBe(0.85);
  });
});
