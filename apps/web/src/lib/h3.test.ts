import { cellToBoundary, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';

import { buildH3Features, h3MaxCount } from './h3';

describe('H3 agregasyonu', () => {
  it('aynı hücredeki noktaları tek özellikte toplar', () => {
    const cell = latLngToCell(41.0082, 28.9784, 9);
    const collection = buildH3Features([
      { lat: 41.0082, lng: 28.9784, cell },
      { lat: 41.0083, lng: 28.9785, cell },
      { lat: 41.0084, lng: 28.9786, cell },
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties).toEqual({ cell, count: 3 });
    expect(h3MaxCount(collection)).toBe(3);
  });

  it('hücre yoksa 9. çözünürlükte türetir', () => {
    const collection = buildH3Features([
      { lat: 41.0082, lng: 28.9784 },
      { lat: 41.0082, lng: 28.9784 },
    ]);

    const expected = latLngToCell(41.0082, 28.9784, 9);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.cell).toBe(expected);
    expect(collection.features[0].properties.count).toBe(2);
  });

  it('kapalı poligon halkası ve [lng, lat] sırası üretir', () => {
    const cell = latLngToCell(41.0082, 28.9784, 9);
    const collection = buildH3Features([{ lat: 41.0082, lng: 28.9784, cell }]);
    const ring = collection.features[0].geometry.coordinates[0];

    expect(ring.length).toBe(cellToBoundary(cell).length + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0][0]).toBeLessThan(41); // boylam ~29
    expect(ring[0][1]).toBeGreaterThan(40); // enlem ~41
  });

  it('geçersiz hücre değerini yok sayar ve yeniden türetir', () => {
    const collection = buildH3Features([{ lat: 41.0082, lng: 28.9784, cell: 'gecersiz' }]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.cell).toBe(latLngToCell(41.0082, 28.9784, 9));
  });

  it('farklı çözünürlükteki rapor hücresini istenen çözünürlüğe normalize eder', () => {
    const fine = latLngToCell(41.0082, 28.9784, 9);
    const collection = buildH3Features([{ lat: 41.0082, lng: 28.9784, cell: fine }], 7);

    const expected = latLngToCell(41.0082, 28.9784, 7);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.cell).toBe(expected);
    expect(collection.features[0].properties.count).toBe(1);
  });

  it('boş girdide boş koleksiyon döner', () => {
    const collection = buildH3Features([]);
    expect(collection.features).toHaveLength(0);
    expect(h3MaxCount(collection)).toBe(0);
  });
});
