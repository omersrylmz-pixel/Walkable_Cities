'use client';

import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers, Loader2, MapPin, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { buildH3Features, h3MaxCount } from '@/lib/h3';
import { STATUS_LABELS, VIOLATION_LABELS, formatDateTime, formatScore } from '@/lib/format';
import type { ReportStatus, ViolationType } from '@/lib/types';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  violationType: ViolationType;
  status: ReportStatus;
  score: number | null;
  capturedAt: string;
  cell: string | null;
}

/** Sunucu tarafında hesaplanmış H3 yoğunluk katmanı (services/api analytics). */
export interface ServerH3FeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      cell: string;
      count: number;
      avgScore: number | null;
      pendingCount: number;
    };
    geometry: { type: 'Polygon'; coordinates: number[][][] };
  }>;
}

export interface ServerH3 {
  featureCollection: ServerH3FeatureCollection;
  maxCount: number;
  resolution: number;
  totalReports: number;
  topAreas: Array<{ name: string; count: number }>;
}

const ISTANBUL_CENTER: [number, number] = [28.9784, 41.0082];

/** Şehir ölçeğinde okunabilir choropleth için H3 çözünürlüğü (hücre ~5 km²). */
const H3_MAP_RESOLUTION = 7;

// Next.js production build'inde MapLibre worker'ı kendi chunk'ından çözemiyor;
// worker `scripts/copy-maplibre-worker.mjs` ile public/ altına kopyalanır.
setWorkerUrl('/maplibre-gl-worker.mjs');

const OSM_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap katkıcıları',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function statusColorExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'status'],
    'pending_review',
    '#d97706',
    'auto_approved',
    '#059669',
    'approved',
    '#047857',
    'auto_rejected',
    '#dc2626',
    'rejected',
    '#b91c1c',
    'failed',
    '#7f1d1d',
    '#475569',
  ];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYNTHETIC_TYPES: ViolationType[] = [
  'kaldirim_isgali',
  'yaya_gecidi_ihlali',
  'sabit_engel',
  'yuzey_bozulmasi',
  'gecici_engel',
];
const SYNTHETIC_STATUSES: ReportStatus[] = ['pending_review', 'auto_approved', 'auto_rejected'];

/** Kümeleme performansını doğrulamak için 10.000 sentetik nokta üretir. */
function buildSyntheticPoints(count: number): MapPoint[] {
  const random = mulberry32(42);
  const points: MapPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const lat = ISTANBUL_CENTER[1] + (random() - 0.5) * 0.5;
    const lng = ISTANBUL_CENTER[0] + (random() - 0.5) * 0.7;
    points.push({
      id: `synthetic-${index}`,
      lat,
      lng,
      violationType: SYNTHETIC_TYPES[Math.floor(random() * SYNTHETIC_TYPES.length)],
      status: SYNTHETIC_STATUSES[Math.floor(random() * SYNTHETIC_STATUSES.length)],
      score: Math.round(random() * 100) / 100,
      capturedAt: new Date(Date.now() - Math.floor(random() * 30 * 24 * 3_600_000)).toISOString(),
      cell: null,
    });
  }
  return points;
}

export function ReportMap({
  points,
  canReview,
  h3,
}: {
  points: MapPoint[];
  canReview: boolean;
  /** Sunucu tarafında filtrelenmiş H3 yoğunluğu; yoksa istemci tarafında hesaplanır. */
  h3?: ServerH3 | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'points' | 'h3'>('points');
  const [loadTest, setLoadTest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const synthetic = useMemo(() => (loadTest ? buildSyntheticPoints(10_000) : []), [loadTest]);
  const visiblePoints = useMemo(
    () => (loadTest ? synthetic : points),
    [loadTest, points, synthetic],
  );

  const pointsGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: visiblePoints.map((point) => ({
        type: 'Feature',
        properties: {
          id: point.id,
          violationType: point.violationType,
          status: point.status,
          score: point.score,
          capturedAt: point.capturedAt,
          cell: point.cell,
        },
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
      })),
    }),
    [visiblePoints],
  );

  const clientH3 = useMemo(
    () => buildH3Features(visiblePoints, H3_MAP_RESOLUTION),
    [visiblePoints],
  );
  const clientH3Max = useMemo(() => h3MaxCount(clientH3), [clientH3]);

  // Yüklenen H3 verisi varsa sunucunun filtrelenmiş agregasyonu kullanılır;
  // yoksa (veya yük testi açıkken) noktalardan istemci tarafında yeniden hesaplanır.
  const useServerH3 = Boolean(h3) && !loadTest;
  const activeH3 = useServerH3 && h3 ? h3.featureCollection : clientH3;
  const activeH3Max = useServerH3 && h3 ? h3.maxCount : clientH3Max;
  const activeResolution = useServerH3 && h3 ? h3.resolution : H3_MAP_RESOLUTION;

  /** Choropleth renk durakları (lejantla aynı değerler). */
  const h3Stops = useMemo(() => {
    const max = Math.max(2, activeH3Max);
    return {
      min: 1,
      q1: Math.max(2, Math.round(max * 0.25)),
      q2: Math.max(3, Math.round(max * 0.6)),
      max,
    };
  }, [activeH3Max]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || OSM_STYLE,
        center: ISTANBUL_CENTER,
        zoom: 10,
        minZoom: 4,
        maxZoom: 19,
        attributionControl: false,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Harita başlatılamadı.');
      return;
    }

    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    let styleLoaded = false;

    map.on('error', (event) => {
      // Yüklenmiş bir stilde oluşan karo (tile) hataları haritayı kilitlemesin.
      if (!styleLoaded && event.error?.message) {
        setError('Harita altlığı yüklenemedi. İnternet bağlantısını kontrol edin.');
      }
    });

    map.on('load', () => {
      styleLoaded = true;
      setError(null);

      map.addSource('reports', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 55,
      });

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'reports',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#7dd3fc',
            25,
            '#0ea5e9',
            100,
            '#0369a1',
            500,
            '#0c4a6e',
          ],
          'circle-radius': ['step', ['get', 'point_count'], 16, 25, 22, 100, 28, 500, 36],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
        },
      });

      try {
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'reports',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 12,
            'text-font': ['Open Sans Semibold'],
          },
          paint: { 'text-color': '#ffffff' },
        });
      } catch {
        // Glyph sağlayıcısı erişilemezse küme sayısı metni atlanır; daireler görünür kalır.
      }

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'reports',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': statusColorExpression(),
          'circle-radius': 6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.addSource('h3', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'h3-fill',
        type: 'fill',
        source: 'h3',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'count'],
            1,
            '#fef3c7',
            5,
            '#fbbf24',
            20,
            '#ea580c',
            60,
            '#991b1b',
          ],
          'fill-opacity': 0.62,
        },
      });

      map.addLayer({
        id: 'h3-outline',
        type: 'line',
        source: 'h3',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#7c2d12', 'line-width': 1, 'line-opacity': 0.55 },
      });

      map.on('click', 'clusters', (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const clusterId = feature.properties?.cluster_id as number | undefined;
        if (clusterId === undefined) return;
        const source = map.getSource('reports') as GeoJSONSource;
        void source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
          map.easeTo({ center: coordinates, zoom });
        });
      });

      map.on('click', 'unclustered-point', (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const properties = feature.properties ?? {};
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

        const container = document.createElement('div');
        container.className = 'space-y-1 text-xs';

        const title = document.createElement('p');
        title.className = 'text-sm font-semibold';
        title.textContent = VIOLATION_LABELS[properties.violationType as ViolationType] ?? 'İhbar';
        container.append(title);

        const status = document.createElement('p');
        status.textContent = `Durum: ${STATUS_LABELS[properties.status as ReportStatus] ?? properties.status}`;
        container.append(status);

        const score = document.createElement('p');
        score.textContent = `Skor: ${formatScore(
          typeof properties.score === 'number' ? properties.score : null,
        )}`;
        container.append(score);

        const captured = document.createElement('p');
        captured.textContent = formatDateTime(String(properties.capturedAt ?? ''));
        container.append(captured);

        if (canReview && !String(properties.id).startsWith('synthetic-')) {
          const link = document.createElement('a');
          link.href = `/review/${properties.id}`;
          link.textContent = 'İncelemeye git';
          link.className = 'inline-block pt-1 font-medium text-sky-700 underline';
          container.append(link);
        }

        new Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(coordinates)
          .setDOMContent(container)
          .addTo(map);
      });

      map.on('click', 'h3-fill', (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const cell = String(feature.properties?.cell ?? '');
        const count = feature.properties?.count as number | undefined;
        const avgScore = feature.properties?.avgScore as number | null | undefined;
        const pendingCount = feature.properties?.pendingCount as number | undefined;
        const container = document.createElement('div');
        container.className = 'space-y-1 text-xs';
        const title = document.createElement('p');
        title.className = 'text-sm font-semibold';
        title.textContent = `H3 ${cell}`;
        const value = document.createElement('p');
        value.textContent = `${count ?? 0} ihbar`;
        container.append(title, value);

        if (typeof avgScore === 'number') {
          const score = document.createElement('p');
          score.textContent = `Ortalama skor: ${formatScore(avgScore)}`;
          container.append(score);
        }
        if (typeof pendingCount === 'number' && pendingCount > 0) {
          const pending = document.createElement('p');
          pending.textContent = `İncelemede: ${pendingCount}`;
          container.append(pending);
        }

        new Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(event.lngLat)
          .setDOMContent(container)
          .addTo(map);
      });

      for (const layer of ['clusters', 'unclustered-point', 'h3-fill']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [canReview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('reports') as GeoJSONSource | undefined;
    source?.setData(pointsGeoJson);
  }, [pointsGeoJson, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('h3') as GeoJSONSource | undefined;
    source?.setData(activeH3 as unknown as GeoJSON.FeatureCollection);
    if (map.getLayer('h3-fill') && activeH3Max >= 2) {
      map.setPaintProperty('h3-fill', 'fill-color', [
        'interpolate',
        ['linear'],
        ['get', 'count'],
        h3Stops.min,
        '#fef3c7',
        h3Stops.q1,
        '#fbbf24',
        h3Stops.q2,
        '#ea580c',
        h3Stops.max,
        '#991b1b',
      ]);
    }
  }, [activeH3, activeH3Max, h3Stops, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const showPoints = mode === 'points';
    for (const layer of ['clusters', 'cluster-count', 'unclustered-point']) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', showPoints ? 'visible' : 'none');
      }
    }
    for (const layer of ['h3-fill', 'h3-outline']) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', showPoints ? 'none' : 'visible');
      }
    }
  }, [mode, ready]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Harita katmanı" className="flex rounded-md border border-border p-1">
          <Button
            type="button"
            size="sm"
            variant={mode === 'points' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'points'}
            onClick={() => setMode('points')}
          >
            <MapPin aria-hidden="true" className="h-4 w-4" />
            Noktalar (kümeleme)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'h3' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'h3'}
            onClick={() => setMode('h3')}
          >
            <Layers aria-hidden="true" className="h-4 w-4" />
            H3 yoğunluk
          </Button>
        </div>

        <Button
          type="button"
          size="sm"
          variant={loadTest ? 'destructive' : 'outline'}
          aria-pressed={loadTest}
          onClick={() => setLoadTest((value) => !value)}
        >
          <TriangleAlert aria-hidden="true" className="h-4 w-4" />
          {loadTest ? 'Test verisini kapat' : '10.000 nokta testi'}
        </Button>

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {loadTest ? 'Sentetik yük testi: 10.000 nokta' : `${visiblePoints.length} ihbar`} ·{' '}
          {activeH3.features.length} H3 hücresi · res {activeResolution}
          {useServerH3 ? ' · sunucu tarafında hesaplandı' : ' · istemcide hesaplandı'}
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {error}
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-lg border border-border">
        <div
          ref={containerRef}
          role="application"
          aria-label="İhbar haritası. Ok tuşlarıyla gezinin, artı/eksi tuşlarıyla yakınlaştırın."
          className="h-[62vh] min-h-[420px] w-full bg-muted"
        />

        {!ready && !error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Harita yükleniyor…
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-border bg-card/95 px-3 py-2 text-xs shadow-sm">
          {mode === 'points' ? (
            <ul className="space-y-1">
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-600" aria-hidden="true" /> İncelemede
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" aria-hidden="true" /> Kabul
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden="true" /> Ret
              </li>
            </ul>
          ) : (
            <div className="space-y-1">
              <p className="font-medium">
                H3 hücresindeki ihbar sayısı · res {activeResolution}
              </p>
              <div className="flex items-center gap-1">
                <span>az</span>
                <span
                  className="h-2 w-24 rounded-sm bg-gradient-to-r from-amber-200 via-orange-500 to-red-800"
                  aria-hidden="true"
                />
                <span>çok</span>
              </div>
              <ul className="flex justify-between text-[10px] text-muted-foreground">
                <li>{h3Stops.min}</li>
                <li>{h3Stops.q1}</li>
                <li>{h3Stops.q2}</li>
                <li>{h3Stops.max}+</li>
              </ul>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Nokta katmanı MapLibre kümelemesi kullanır; 10.000 nokta testiyle kümeleme performansı
        doğrulanabilir. H3 katmanı varsayılan olarak API tarafında ({' '}
        <code className="rounded bg-muted px-1">GET /v1/analytics/h3</code> ) çözünürlük, zaman
        aralığı ve ihlal türü filtreleriyle hesaplanır; API'ye ulaşılamazsa noktalardan istemcide
        yeniden hesaplanır.
      </p>
    </div>
  );
}
