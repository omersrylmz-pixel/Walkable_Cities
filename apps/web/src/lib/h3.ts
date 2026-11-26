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

export interface H3ScaleLegendItem {
  count: number;
  label: string;
  color: string;
}

export interface H3Scale {
  /** MapLibre `interpolate` için artan sıralı [ihbar sayısı, renk] çiftleri. */
  stops: Array<[number, string]>;
  /** Lejantta gösterilecek etiketli duraklar. */
  legend: H3ScaleLegendItem[];
  maxCount: number;
}

/** Düşük yoğunlukta açık, yüksek yoğunlukta koyu kırmızıya giden sıralı palet. */
export const H3_PALETTE = [
  '#fef3c7',
  '#fde68a',
  '#fdba74',
  '#f97316',
  '#dc2626',
  '#7f1d1d',
] as const;

/**
 * Hücre sayılarından MapLibre choropleth ölçeği üretir.
 *
 * Sabit eşikler yerine verinin çeyrekliklerini kullanır; böylece az sayıda
 * yoğun hücre varken bile renkler anlamlı dağılır. Duraklar her zaman kesin
 * artan ve tekildir (MapLibre aksi hâlde ifadeyi reddeder).
 */
export function buildH3Scale(counts: readonly number[]): H3Scale {
  const positive = counts.filter((count) => count > 0).sort((a, b) => a - b);

  if (positive.length === 0) {
    // Boş veride de MapLibre'nin kabul ettiği en az iki duraklı ifade döndür.
    return {
      stops: [
        [1, H3_PALETTE[0]],
        [2, H3_PALETTE[H3_PALETTE.length - 1]],
      ],
      legend: [],
      maxCount: 0,
    };
  }

  const maxCount = positive[positive.length - 1];
  const quantile = (q: number) =>
    positive[Math.min(positive.length - 1, Math.max(0, Math.floor(q * (positive.length - 1))))];

  const values = [...new Set([1, quantile(0.5), quantile(0.8), maxCount])].sort((a, b) => a - b);
  // Tek bir değer varsa interpolate için ikinci bir durak ekle.
  if (values.length === 1) values.push(values[0] + 1);

  const last = values.length - 1;
  const stops = values.map((value, index) => {
    const colorIndex = Math.round((index / last) * (H3_PALETTE.length - 1));
    return [value, H3_PALETTE[colorIndex]] as [number, string];
  });

  const legend = stops.map(([count, color], index) => ({
    count,
    color,
    // Son durak üst sınırı temsil eder; kullanıcıya "N+" olarak gösterilir.
    label: index === last ? `${maxCount}+` : String(count),
  }));

  return { stops, legend, maxCount };
}
