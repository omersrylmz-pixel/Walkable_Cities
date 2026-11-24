import { cellToBoundary, getResolution, isValidCell, latLngToCell } from 'h3-js';

export interface H3Point {
  lat: number;
  lng: number;
  cell?: string | null;
}

export interface H3CellProperties {
  cell: string;
  count: number;
}

export type H3FeatureCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: H3CellProperties;
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
  }[];
};

/**
 * İhbarları H3 hücrelerine göre sayar ve MapLibre'nin beklediği
 * GeoJSON Polygon koleksiyonunu üretir.
 *
 * Raporun kendi H3 hücresi istenen çözünürlükteyse o kullanılır; değilse
 * enlem/boylamdan istenen çözünürlükte hücre türetilir. Böylece farklı
 * çözünürlükteki kayıtlar tek bir choropleth ölçeğinde toplanır.
 */
export function buildH3Features(points: readonly H3Point[], resolution = 9): H3FeatureCollection {
  const counts = new Map<string, number>();

  for (const point of points) {
    const cell =
      point.cell && isValidCell(point.cell) && getResolution(point.cell) === resolution
        ? point.cell
        : latLngToCell(point.lat, point.lng, resolution);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }

  const features: H3FeatureCollection['features'] = [];

  for (const [cell, count] of counts) {
    const boundary = cellToBoundary(cell); // [lat, lng][]
    if (boundary.length < 3) continue;
    const ring = boundary.map(([lat, lng]) => [lng, lat] as number[]);
    ring.push(ring[0]);
    features.push({
      type: 'Feature',
      properties: { cell, count },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** Haritada kullanılacak renk skalası için üst sınırı (yuvarlanmış) döndürür. */
export function h3MaxCount(collection: H3FeatureCollection): number {
  return collection.features.reduce((max, feature) => Math.max(max, feature.properties.count), 0);
}
