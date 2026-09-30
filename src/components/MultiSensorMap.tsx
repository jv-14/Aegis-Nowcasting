import React, { useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  Radio,
  Zap,
  Crosshair,
  Wind,
  AlertTriangle,
  Navigation,
  Plus,
  Minus,
  Maximize2,
  Play,
  Pause,
  Target,
  GitBranch,
  Layers,
  Flame,
  Sun,
  Moon,
} from 'lucide-react';
import type {
  ObservationBundle,
  DopplerRadarStation,
  ConvectiveCell,
  TrackForecastPoint,
  AiNowcastResult,
} from '../types/nowcast';

export type BaseMapMode =
  | 'AUTO_DAY_NIGHT'
  | 'DARK_TACTICAL'
  | 'HYBRID_SAT'
  | 'SATELLITE_RAW'
  | 'TERRAIN_TOPO'
  | 'LIGHT_DAY';

export interface MapLayerState {
  baseMapMode?: BaseMapMode;
  solarTerminator?: boolean;
  radar: boolean;
  radarOpacity: number;
  satellite: boolean;
  satelliteOpacity: number;
  nexradHiRes: boolean;
  radarBeams: boolean;
  lightning: boolean;
  lightningHeatmap: boolean;
  nowcastCones: boolean;
  nwpGrid: boolean;
}

interface MultiSensorMapProps {
  apiKey: string;
  bundle: ObservationBundle | null;
  nowcast?: AiNowcastResult | null;
  layers: MapLayerState;
  onUpdateLayers?: React.Dispatch<React.SetStateAction<MapLayerState>>;
  activeRadarFrameIndex: number;
  selectedNowcastMinute: number;
  onSelectNowcastMinute?: (min: number) => void;
  selectedCellId: string | null;
  onSelectCell: (cell: ConvectiveCell) => void;
  selectedStationId: string | null;
  onSelectStation: (station: DopplerRadarStation) => void;
  onMapCoordinateClick: (lat: number, lon: number) => void;
}

// Shared In-Memory LRU Image Cache & In-Flight Request Deduplicator for 0ms Tile Overzoom & Loop Playback
const GLOBAL_TILE_IMAGE_CACHE = new globalThis.Map<string, HTMLImageElement>();
const IN_FLIGHT_TILE_PROMISES = new globalThis.Map<string, Promise<HTMLImageElement>>();
const MAX_CACHED_TILE_IMAGES = 320;

function fetchAndCacheTileImage(url: string): Promise<HTMLImageElement> {
  const cached = GLOBAL_TILE_IMAGE_CACHE.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  const inFlight = IN_FLIGHT_TILE_PROMISES.get(url);
  if (inFlight) {
    return inFlight;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      IN_FLIGHT_TILE_PROMISES.delete(url);
      if (GLOBAL_TILE_IMAGE_CACHE.size >= MAX_CACHED_TILE_IMAGES) {
        const oldestKey = GLOBAL_TILE_IMAGE_CACHE.keys().next().value;
        if (oldestKey) GLOBAL_TILE_IMAGE_CACHE.delete(oldestKey);
      }
      GLOBAL_TILE_IMAGE_CACHE.set(url, img);
      resolve(img);
    };
    img.onerror = (err) => {
      IN_FLIGHT_TILE_PROMISES.delete(url);
      reject(err);
    };
    img.src = url;
  });

  IN_FLIGHT_TILE_PROMISES.set(url, promise);
  return promise;
}

export interface UpdatableTileMapType extends google.maps.MapType {
  setOpacity: (opacity: number) => void;
}

// High-DPI (512x512 Retina backing store) Google Maps MapType with 0ms Cached Client-Side Overzooming
// and zero CSS blur filters.
function createOverzoomTileMapType(options: {
  name: string;
  opacity: number;
  minNativeZoom: number;
  maxNativeZoom: number;
  smoothOverzoom?: boolean;
  getNativeTileUrl: (x: number, y: number, nativeZoom: number) => string | null;
}): UpdatableTileMapType {
  let currentOpacity = options.opacity;
  const activeTileElements = new Set<HTMLElement>();

  return {
    tileSize: new google.maps.Size(256, 256),
    name: options.name,
    alt: options.name,
    projection: null,
    radius: 6378137,
    maxZoom: 20,
    minZoom: 1,
    setOpacity(newOpacity: number): void {
      currentOpacity = newOpacity;
      const opStr = String(newOpacity);
      activeTileElements.forEach((el) => {
        el.style.opacity = opStr;
      });
    },
    getTile(
      coord: google.maps.Point | null,
      zoom: number,
      ownerDocument: Document | null
    ): HTMLElement {
      const doc = ownerDocument || document;
      const intZoom = Math.round(zoom);

      if (!coord || intZoom < options.minNativeZoom) {
        const empty = doc.createElement('div');
        empty.style.width = '256px';
        empty.style.height = '256px';
        empty.style.pointerEvents = 'none';
        return empty;
      }

      const totalTilesAtZoom = 1 << intZoom;
      if (coord.y < 0 || coord.y >= totalTilesAtZoom) {
        const empty = doc.createElement('div');
        empty.style.width = '256px';
        empty.style.height = '256px';
        empty.style.pointerEvents = 'none';
        return empty;
      }

      // Normalize X coordinate across world dateline wrap
      const normX = ((coord.x % totalTilesAtZoom) + totalTilesAtZoom) % totalTilesAtZoom;

      // Clamp network request zoom to maxNativeZoom so upstream never returns "Zoom level not supported"
      const nativeZoom = Math.min(intZoom, options.maxNativeZoom);
      const zoomDiff = Math.max(0, intZoom - nativeZoom);
      const scale = 1 << zoomDiff; // 1 at native zoom, 2 at +1, 4 at +2, 8 at +3, etc.

      const parentX = Math.floor(normX / scale);
      const parentY = Math.floor(coord.y / scale);
      const offsetX = normX % scale;
      const offsetY = coord.y % scale;

      const tileUrl = options.getNativeTileUrl(parentX, parentY, nativeZoom);
      if (!tileUrl) {
        const empty = doc.createElement('div');
        empty.style.width = '256px';
        empty.style.height = '256px';
        empty.style.pointerEvents = 'none';
        return empty;
      }

      // Allocate crisp High-DPI 512x512 backing canvas mapped to 256x256 CSS pixels
      const dpr = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
      const backingSize = 256 * dpr;
      const canvas = doc.createElement('canvas');
      canvas.width = backingSize;
      canvas.height = backingSize;
      canvas.style.width = '256px';
      canvas.style.height = '256px';
      canvas.style.display = 'block';
      canvas.style.pointerEvents = 'none';
      canvas.style.userSelect = 'none';
      canvas.style.opacity = String(currentOpacity);
      (canvas as HTMLCanvasElement & { __disposed?: boolean }).__disposed = false;

      activeTileElements.add(canvas);

      const drawCroppedImage = (img: HTMLImageElement) => {
        if ((canvas as HTMLCanvasElement & { __disposed?: boolean }).__disposed) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const srcW = img.naturalWidth || 256;
        const srcH = img.naturalHeight || 256;
        const subW = srcW / scale;
        const subH = srcH / scale;
        const sx = offsetX * subW;
        const sy = offsetY * subH;

        ctx.clearRect(0, 0, backingSize, backingSize);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, subW, subH, 0, 0, backingSize, backingSize);
      };

      // Instantaneous 0ms synchronous draw if parent/current tile is already in memory cache
      const cachedImg = GLOBAL_TILE_IMAGE_CACHE.get(tileUrl);
      if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
        drawCroppedImage(cachedImg);
        return canvas;
      }

      fetchAndCacheTileImage(tileUrl)
        .then((img) => {
          drawCroppedImage(img);
        })
        .catch(() => {
          // Fallback to direct <img> cropping if upstream server lacks CORS headers for canvas read
          if ((canvas as HTMLCanvasElement & { __disposed?: boolean }).__disposed) return;
          const fallbackImg = doc.createElement('img');
          fallbackImg.src = tileUrl;
          fallbackImg.alt = '';
          fallbackImg.draggable = false;
          fallbackImg.decoding = 'async';
          fallbackImg.style.position = 'absolute';
          fallbackImg.style.left = `${-offsetX * 256}px`;
          fallbackImg.style.top = `${-offsetY * 256}px`;
          fallbackImg.style.width = `${256 * scale}px`;
          fallbackImg.style.height = `${256 * scale}px`;
          fallbackImg.style.maxWidth = 'none';
          fallbackImg.style.maxHeight = 'none';
          fallbackImg.style.pointerEvents = 'none';
          const parent = canvas.parentElement;
          if (parent) {
            parent.style.overflow = 'hidden';
            parent.appendChild(fallbackImg);
          }
        });

      return canvas;
    },
    releaseTile(tile: Element | null): void {
      if (tile) {
        (tile as HTMLCanvasElement & { __disposed?: boolean }).__disposed = true;
        activeTileElements.delete(tile as HTMLElement);
      }
    },
  };
}

// Precompute 256-entry Scientific Color Lookup Tables for the 4 GOES-R GLM Gridded Products
export type GlmProductMode = 'FED' | 'TOE' | 'MFA' | 'LJA';
export type GlmPolarityFilter = 'ALL' | 'CG+' | 'CG-' | 'IC';

interface ColorStop {
  pos: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

function buildColorLut(stops: ColorStop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let j = 0; j < stops.length - 1; j++) {
      if (i >= stops[j].pos && i <= stops[j + 1].pos) {
        s0 = stops[j];
        s1 = stops[j + 1];
        break;
      }
    }
    const t = s1.pos === s0.pos ? 0 : (i - s0.pos) / (s1.pos - s0.pos);
    lut[i * 4] = Math.round(s0.r + (s1.r - s0.r) * t);
    lut[i * 4 + 1] = Math.round(s0.g + (s1.g - s0.g) * t);
    lut[i * 4 + 2] = Math.round(s0.b + (s1.b - s0.b) * t);
    lut[i * 4 + 3] = Math.round(s0.a + (s1.a - s0.a) * t);
  }
  return lut;
}

const GLM_PRODUCT_LUTS: Record<GlmProductMode, Uint8ClampedArray> = {
  // FED: Flash Extent Density (fl/min) - GOES-R Operational Thermal Plasma
  FED: buildColorLut([
    { pos: 0, r: 14, g: 165, b: 233, a: 0 },
    { pos: 22, r: 14, g: 165, b: 233, a: 110 },   // Low FED: Deep Electric Cyan
    { pos: 68, r: 16, g: 185, b: 129, a: 170 },   // Moderate-Low FED: Emerald-Cyan
    { pos: 125, r: 250, g: 204, b: 21, a: 215 },  // Moderate-High FED: Solar Yellow-Amber
    { pos: 180, r: 249, g: 115, b: 22, a: 238 },  // High FED: Intense Convective Orange
    { pos: 225, r: 244, g: 63, b: 94, a: 252 },   // Severe Core: Crimson-Magenta
    { pos: 255, r: 255, g: 248, b: 255, a: 255 }, // Extreme Lightning Jump Core: White-Violet
  ]),
  // TOE: Total Optical Energy (fJ) - Deep Violet -> Magenta -> Gold -> White
  TOE: buildColorLut([
    { pos: 0, r: 79, g: 70, b: 229, a: 0 },
    { pos: 24, r: 99, g: 102, b: 241, a: 115 },
    { pos: 80, r: 168, g: 85, b: 247, a: 175 },
    { pos: 140, r: 236, g: 72, b: 153, a: 220 },
    { pos: 195, r: 245, g: 158, b: 11, a: 242 },
    { pos: 235, r: 253, g: 224, b: 71, a: 252 },
    { pos: 255, r: 255, g: 255, b: 255, a: 255 },
  ]),
  // MFA: Minimum Flash Area / Updraft Core Concentration (km^2 inverse) - Deep Teal -> Cyan -> Sky -> White
  MFA: buildColorLut([
    { pos: 0, r: 13, g: 148, b: 136, a: 0 },
    { pos: 26, r: 20, g: 184, b: 166, a: 115 },
    { pos: 85, r: 6, g: 182, b: 212, a: 175 },
    { pos: 145, r: 56, g: 189, b: 248, a: 220 },
    { pos: 205, r: 129, g: 140, b: 248, a: 242 },
    { pos: 255, r: 248, g: 250, b: 252, a: 255 },
  ]),
  // LJA: 2-Sigma Lightning Jump Anomaly (df/dt) - Amber -> Flame Orange -> Crimson -> Magenta-White
  LJA: buildColorLut([
    { pos: 0, r: 245, g: 158, b: 11, a: 0 },
    { pos: 32, r: 245, g: 158, b: 11, a: 110 },
    { pos: 90, r: 249, g: 115, b: 22, a: 180 },
    { pos: 150, r: 239, g: 68, b: 68, a: 225 },
    { pos: 205, r: 225, g: 29, b: 72, a: 248 },
    { pos: 255, r: 255, g: 240, b: 255, a: 255 },
  ]),
};

interface GlmHeatKernelPoint {
  lat: number;
  lon: number;
  radiusKm: number;
  intensity: number;
}

interface GlmHeatmapConfig {
  productMode: GlmProductMode;
  polarityFilter: GlmPolarityFilter;
  timeWindowMin: number;
  opacity: number;
  radiusScale: number;
  showContours: boolean;
  includeAdvected: boolean;
}

export interface GlmCursorProbeTelemetry {
  lat: number;
  lon: number;
  fedFlPerMin: number;
  toeFemtoJoules: number;
  minFlashAreaKm2: number;
  jumpSigma: number;
  nearestStrikeDistKm: number | null;
  nearestStrikePolarity: string | null;
  nearestStrikeKa: number | null;
}

function fastHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Evaluates exact physical GOES-R GLM metrics at any map coordinate (lat, lon)
function evaluateGlmPointTelemetry(
  lat: number,
  lon: number,
  bundle: ObservationBundle,
  nowcast: AiNowcastResult | null | undefined,
  selectedNowcastMinute: number,
  config: GlmHeatmapConfig
): GlmCursorProbeTelemetry {
  let fedSum = 0;
  let toeSum = 0;
  let weightedAreaSum = 0;
  let weightTotal = 0;
  let maxSigma = 0;

  let nearestDist = Infinity;
  let nearestPol: string | null = null;
  let nearestKa: number | null = null;

  // 1. Contributions from filtered individual GLM/VLF strikes
  bundle.lightningStrikes.forEach((ltg) => {
    if (ltg.ageMinutes > config.timeWindowMin) return;
    if (config.polarityFilter !== 'ALL' && ltg.polarity !== config.polarityFilter) return;

    const dKm = fastHaversineKm(lat, lon, ltg.lat, ltg.lon);
    if (dKm < nearestDist) {
      nearestDist = dKm;
      nearestPol = ltg.polarity;
      nearestKa = ltg.peakCurrentKa;
    }

    const kernelR = (ltg.polarity === 'CG+' ? 22 : 16) * config.radiusScale;
    if (dKm <= kernelR * 1.8) {
      const gauss = Math.exp(-(dKm * dKm) / (2 * Math.pow(kernelR * 0.52, 2)));
      const recency = Math.exp(-ltg.ageMinutes / Math.max(5, config.timeWindowMin));
      const energyFactor =
        (Math.pow(Math.abs(ltg.peakCurrentKa) / 28, 1.35) + 0.5) * ltg.multiplicity;
      fedSum += gauss * recency * (0.45 + 0.22 * ltg.multiplicity);
      toeSum += gauss * recency * energyFactor * 18.5;
      const estFlashArea = ltg.polarity === 'CG+' ? 185 : ltg.polarity === 'IC' ? 42 : 95;
      weightedAreaSum += estFlashArea * gauss;
      weightTotal += gauss;
    }
  });

  // 2. Contributions from Convective Cell Updraft Charging Cores & Anvils (strictly when real electrification is active)
  bundle.convectiveCells.forEach((cell, idx) => {
    if (cell.flashRatePerMin <= 0 && cell.maxDbz < 35) return;
    const dCore = fastHaversineKm(lat, lon, cell.lat, cell.lon);
    const coreR = 26 * config.radiusScale;
    if (dCore <= coreR * 1.8 && cell.flashRatePerMin > 0) {
      const gauss = Math.exp(-(dCore * dCore) / (2 * Math.pow(coreR * 0.5, 2)));
      fedSum += gauss * (cell.flashRatePerMin * 0.68);
      toeSum += gauss * (cell.flashRatePerMin * 24.0 * (1 + cell.vilKgM2 / 35));
      const coreArea = Math.max(18, 130 - cell.maxDbz * 1.6);
      weightedAreaSum += coreArea * gauss * 2;
      weightTotal += gauss * 2;

      const cellSigma =
        (cell.flashRatePerMin / 10) * 0.85 +
        Math.abs(cell.coolingRateCPer15m) / 4.2 +
        (cell.maxDbz >= 52 ? 0.9 : 0.2);
      if (cellSigma * gauss > maxSigma) {
        maxSigma = cellSigma * gauss;
      }
    }

    if (config.includeAdvected) {
      const tf = cell.trackForecast.find((t) => t.minOffset === selectedNowcastMinute);
      if (tf) {
        const dAdv = fastHaversineKm(lat, lon, tf.lat, tf.lon);
        const advR = Math.max(18, tf.radiusKm * 1.4) * config.radiusScale;
        const syncedFlash =
          idx === 0 && nowcast
            ? nowcast.timelineProjections.find((p) => p.minuteOffset === selectedNowcastMinute)
                ?.expectedFlashRate ?? tf.projectedFlashRate
            : tf.projectedFlashRate;
        if (dAdv <= advR * 1.6 && syncedFlash > 0) {
          const gauss = Math.exp(-(dAdv * dAdv) / (2 * Math.pow(advR * 0.5, 2)));
          fedSum += gauss * (syncedFlash * 0.55);
          toeSum += gauss * (syncedFlash * 19.5);
          const sigmaAdv = (syncedFlash / 11) * 0.9;
          if (sigmaAdv * gauss > maxSigma) {
            maxSigma = sigmaAdv * gauss;
          }
        }
      }
    }
  });

  const minFlashAreaKm2 =
    weightTotal > 0.05
      ? Number(Math.max(14, Math.min(320, weightedAreaSum / weightTotal)).toFixed(0))
      : 0;

  return {
    lat: Number(lat.toFixed(3)),
    lon: Number(lon.toFixed(3)),
    fedFlPerMin: Number(Math.min(95, fedSum).toFixed(1)),
    toeFemtoJoules: Number(Math.min(2500, toeSum).toFixed(0)),
    minFlashAreaKm2,
    jumpSigma: Number(Math.min(4.5, maxSigma).toFixed(2)),
    nearestStrikeDistKm: nearestDist < Infinity ? Number(nearestDist.toFixed(1)) : null,
    nearestStrikePolarity: nearestPol,
    nearestStrikeKa: nearestKa,
  };
}

const GLM_TILE_IMAGE_DATA_CACHE = new globalThis.Map<string, ImageData>();
const MAX_GLM_CACHED_TILES = 160;

// Builds a seamless, all-zoom Web Mercator 2-Pass Gaussian Kernel Density MapType for GLM Lightning Flash Density
function createGlmFlashDensityHeatmapMapType(
  bundle: ObservationBundle,
  selectedNowcastMinute: number,
  nowcast: AiNowcastResult | null | undefined,
  config: GlmHeatmapConfig
): UpdatableTileMapType {
  const kernels: GlmHeatKernelPoint[] = [];
  const activeLut = GLM_PRODUCT_LUTS[config.productMode] || GLM_PRODUCT_LUTS.FED;
  let currentOpacity = config.opacity;
  const activeCanvases = new Set<HTMLElement>();

  // 1. Individual GLM / VLF Lightning Strike Kernels filtered by Polarity & Temporal Window
  bundle.lightningStrikes.forEach((ltg) => {
    if (ltg.ageMinutes > config.timeWindowMin) return;
    if (config.polarityFilter !== 'ALL' && ltg.polarity !== config.polarityFilter) return;

    const recencyWeight = Math.max(
      0.2,
      Math.exp(-ltg.ageMinutes / Math.max(5, config.timeWindowMin * 0.85))
    );
    const currentWeight = Math.min(1.2, Math.abs(ltg.peakCurrentKa) / 55);
    const multWeight = Math.min(1.4, 0.78 + ltg.multiplicity * 0.16);
    const polarityBoost =
      ltg.polarity === 'CG+' ? 1.35 : ltg.polarity === 'CG-' ? 1.12 : 0.95;

    let rawIntensity =
      0.36 * recencyWeight * (0.52 + 0.48 * currentWeight) * multWeight * polarityBoost;
    let baseRadiusKm = ltg.polarity === 'CG+' ? 23 : ltg.polarity === 'CG-' ? 17 : 15;

    if (config.productMode === 'TOE') {
      rawIntensity *= 0.75 + currentWeight * 0.65;
      baseRadiusKm *= 1.12;
    } else if (config.productMode === 'MFA') {
      rawIntensity *= ltg.polarity === 'IC' ? 1.28 : 0.85;
      baseRadiusKm *= 0.82;
    } else if (config.productMode === 'LJA') {
      rawIntensity *= ltg.ageMinutes <= 8 ? 1.38 : 0.55;
      baseRadiusKm *= 0.92;
    }

    kernels.push({
      lat: ltg.lat,
      lon: ltg.lon,
      radiusKm: baseRadiusKm * config.radiusScale,
      intensity: Math.min(0.92, Math.max(0.16, rawIntensity)),
    });
  });

  // 2. Convective Cell Optical Flash Extent Density (FED) Core, Anisotropic Anvil Plume & Advected Core Kernels
  // Strictly only when real electrification (flashRatePerMin > 0) is observed or forecast
  bundle.convectiveCells.forEach((cell, idx) => {
    const flashRate = cell.flashRatePerMin;
    if (flashRate > 0) {
      let coreIntensity = Math.min(0.95, Math.max(0.28, flashRate / 28));
      if (config.productMode === 'LJA') {
        const jumpFactor =
          (Math.abs(cell.coolingRateCPer15m) / 8) * 0.5 + (flashRate / 22) * 0.65;
        coreIntensity = Math.min(0.96, Math.max(0.24, jumpFactor));
      } else if (config.productMode === 'MFA') {
        coreIntensity = Math.min(0.94, Math.max(0.28, (cell.maxDbz - 20) / 42));
      }

      // Primary Updraft Charging Core
      kernels.push({
        lat: cell.lat,
        lon: cell.lon,
        radiusKm: 25 * config.radiusScale,
        intensity: coreIntensity,
      });

      // Anisotropic Down-Shear Anvil Electrification Plume along cell.headingDeg
      if (config.productMode !== 'MFA') {
        const anvilPos1 = computeDestination(cell.lat, cell.lon, 11, cell.headingDeg);
        const anvilPos2 = computeDestination(cell.lat, cell.lon, 21, cell.headingDeg);
        kernels.push(
          {
            lat: anvilPos1.lat,
            lon: anvilPos1.lng,
            radiusKm: 29 * config.radiusScale,
            intensity: coreIntensity * 0.68,
          },
          {
            lat: anvilPos2.lat,
            lon: anvilPos2.lng,
            radiusKm: 33 * config.radiusScale,
            intensity: coreIntensity * 0.42,
          }
        );
      }
    }

    // Advected Lightning Flash Density Core & Corridor at selectedNowcastMinute
    if (config.includeAdvected) {
      const tf = cell.trackForecast.find((t) => t.minOffset === selectedNowcastMinute);
      if (tf) {
        const syncedFlash =
          idx === 0 && nowcast
            ? nowcast.timelineProjections.find((p) => p.minuteOffset === selectedNowcastMinute)
                ?.expectedFlashRate ?? tf.projectedFlashRate
            : tf.projectedFlashRate;
        if (syncedFlash > 0) {
          const advIntensity = Math.min(0.9, Math.max(0.24, (syncedFlash / 30) * 0.86));
          const midLat = (cell.lat + tf.lat) / 2;
          const midLon = (cell.lon + tf.lon) / 2;
          kernels.push(
            {
              lat: midLat,
              lon: midLon,
              radiusKm: Math.max(16, tf.radiusKm * 1.05) * config.radiusScale,
              intensity: advIntensity * 0.52,
            },
            {
              lat: tf.lat,
              lon: tf.lon,
              radiusKm: Math.max(19, tf.radiusKm * 1.42) * config.radiusScale,
              intensity: advIntensity,
            }
          );
        }
      }
    }
  });

  const cacheSignature = `${bundle.fetchedAtUtc}|${selectedNowcastMinute}|${config.productMode}|${config.polarityFilter}|${config.timeWindowMin}|${config.radiusScale}|${config.showContours ? 1 : 0}|${config.includeAdvected ? 1 : 0}`;

  return {
    tileSize: new google.maps.Size(256, 256),
    name: `GLM ${config.productMode} Heatmap`,
    alt: `GLM ${config.productMode} Heatmap`,
    projection: null,
    radius: 6378137,
    maxZoom: 20,
    minZoom: 1,
    setOpacity(newOpacity: number): void {
      currentOpacity = newOpacity;
      const opStr = String(newOpacity);
      activeCanvases.forEach((el) => {
        el.style.opacity = opStr;
      });
    },
    getTile(
      coord: google.maps.Point | null,
      zoom: number,
      ownerDocument: Document | null
    ): HTMLElement {
      const doc = ownerDocument || document;
      const intZoom = Math.round(zoom);

      if (!coord || intZoom < 2 || kernels.length === 0) {
        const empty = doc.createElement('div');
        empty.style.width = '256px';
        empty.style.height = '256px';
        empty.style.pointerEvents = 'none';
        return empty;
      }

      const totalTiles = 1 << intZoom;
      if (coord.y < 0 || coord.y >= totalTiles) {
        const empty = doc.createElement('div');
        empty.style.width = '256px';
        empty.style.height = '256px';
        empty.style.pointerEvents = 'none';
        return empty;
      }

      const normTileX = ((coord.x % totalTiles) + totalTiles) % totalTiles;
      const worldSize = 256 * totalTiles;

      // Fast spatial culling before allocating a canvas
      const tileKernels: Array<{ localX: number; localY: number; radiusPx: number; intensity: number }> = [];
      for (let i = 0; i < kernels.length; i++) {
        const k = kernels[i];
        const sinLat = Math.sin((k.lat * Math.PI) / 180);
        const clampedSin = Math.max(-0.9999, Math.min(0.9999, sinLat));
        const globalX = ((k.lon + 180) / 360) * worldSize;
        const globalY =
          (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI)) *
          worldSize;

        const kmPerPixel =
          (Math.cos((k.lat * Math.PI) / 180) * 40075.016686) / worldSize;
        const radiusPx = Math.max(12, Math.min(125, k.radiusKm / Math.max(0.05, kmPerPixel)));

        const localX = globalX - normTileX * 256;
        const localY = globalY - coord.y * 256;

        if (
          localX >= -radiusPx &&
          localX <= 256 + radiusPx &&
          localY >= -radiusPx &&
          localY <= 256 + radiusPx
        ) {
          tileKernels.push({ localX, localY, radiusPx, intensity: k.intensity });
        }
      }

      if (tileKernels.length === 0) {
        const empty = doc.createElement('div');
        empty.style.width = '256px';
        empty.style.height = '256px';
        empty.style.pointerEvents = 'none';
        return empty;
      }

      const canvas = doc.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      canvas.style.width = '256px';
      canvas.style.height = '256px';
      canvas.style.pointerEvents = 'none';
      canvas.style.opacity = String(currentOpacity);
      activeCanvases.add(canvas);

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return canvas;

      const tileCacheKey = `${cacheSignature}|${intZoom}/${normTileX}/${coord.y}`;
      const cachedData = GLM_TILE_IMAGE_DATA_CACHE.get(tileCacheKey);
      if (cachedData) {
        ctx.putImageData(cachedData, 0, 0);
        return canvas;
      }

      // Pass 1: Accumulate Gaussian flash energy kernels in alpha channel
      for (let i = 0; i < tileKernels.length; i++) {
        const tk = tileKernels[i];
        const grad = ctx.createRadialGradient(
          tk.localX,
          tk.localY,
          0,
          tk.localX,
          tk.localY,
          tk.radiusPx
        );
        grad.addColorStop(0, `rgba(0, 0, 0, ${tk.intensity})`);
        grad.addColorStop(0.42, `rgba(0, 0, 0, ${tk.intensity * 0.58})`);
        grad.addColorStop(0.75, `rgba(0, 0, 0, ${tk.intensity * 0.22})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(tk.localX, tk.localY, tk.radiusPx, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pass 2: Map accumulated alpha intensity through the 256-entry GOES-R GLM Product LUT + Iso-Contour Rings
      const imgData = ctx.getImageData(0, 0, 256, 256);
      const data = imgData.data;
      for (let p = 0; p < data.length; p += 4) {
        const alpha = data[p + 3];
        if (alpha > 3) {
          const isContourLine =
            config.showContours &&
            ((alpha >= 72 && alpha <= 76) ||
              (alpha >= 138 && alpha <= 143) ||
              (alpha >= 202 && alpha <= 207));

          if (isContourLine) {
            data[p] = 255;
            data[p + 1] = 250;
            data[p + 2] = 240;
            data[p + 3] = 245;
          } else {
            const lutIdx = alpha * 4;
            data[p] = activeLut[lutIdx];
            data[p + 1] = activeLut[lutIdx + 1];
            data[p + 2] = activeLut[lutIdx + 2];
            data[p + 3] = activeLut[lutIdx + 3];
          }
        } else {
          data[p + 3] = 0;
        }
      }

      if (GLM_TILE_IMAGE_DATA_CACHE.size >= MAX_GLM_CACHED_TILES) {
        const oldest = GLM_TILE_IMAGE_DATA_CACHE.keys().next().value;
        if (oldest) GLM_TILE_IMAGE_DATA_CACHE.delete(oldest);
      }
      GLM_TILE_IMAGE_DATA_CACHE.set(tileCacheKey, imgData);
      ctx.putImageData(imgData, 0, 0);

      return canvas;
    },
    releaseTile(tile: Element | null): void {
      if (tile) {
        activeCanvases.delete(tile as HTMLElement);
      }
    },
  };
}

// Builds an anisotropic elliptical GLM Flash Density Iso-Contour polygon aligned with the storm's anvil heading
function buildAnisotropicGlmContourPath(
  centerLat: number,
  centerLon: number,
  minorRadiusKm: number,
  majorRadiusKm: number,
  headingDeg: number
): google.maps.LatLngLiteral[] {
  const pts: google.maps.LatLngLiteral[] = [];
  // Shift ellipse center slightly downstream toward the anvil
  const shiftedCenter = computeDestination(
    centerLat,
    centerLon,
    (majorRadiusKm - minorRadiusKm) * 0.35,
    headingDeg
  );
  for (let deg = 0; deg < 360; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    // Polar equation of ellipse aligned with headingDeg
    const rKm =
      (minorRadiusKm * majorRadiusKm) /
      Math.sqrt(
        Math.pow(minorRadiusKm * Math.cos(rad), 2) +
          Math.pow(majorRadiusKm * Math.sin(rad), 2)
      );
    const brng = (headingDeg + deg + 360) % 360;
    pts.push(computeDestination(shiftedCenter.lat, shiftedCenter.lng, rKm, brng));
  }
  return pts;
}

// Destination helper for building cone polygon vertices on the map
function computeDestination(lat: number, lon: number, distKm: number, brngDeg: number) {
  const R = 6371;
  const d = distKm / R;
  const brng = (brngDeg * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(brng)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(phi1),
      Math.cos(d) - Math.sin(phi1) * Math.sin(phi2)
    );

  return {
    lat: (phi2 * 180) / Math.PI,
    lng: (lambda2 * 180) / Math.PI,
  };
}

// Builds a smooth geodesic storm swath cone polygon with rounded origin and terminal circular arc cap
function buildSmoothStormConePath(
  originLat: number,
  originLon: number,
  originRadiusKm: number,
  trackPoints: TrackForecastPoint[],
  headingDeg: number,
  radiusScale: number = 1.0
): google.maps.LatLngLiteral[] {
  if (trackPoints.length === 0) return [];

  const leftPerp = (headingDeg - 90 + 360) % 360;
  const rightPerp = (headingDeg + 90) % 360;

  const points: google.maps.LatLngLiteral[] = [];

  // 1. Rear semicircle arc around origin core (from rightPerp through rear to leftPerp)
  for (let a = 90; a <= 270; a += 22.5) {
    const brng = (headingDeg + a + 360) % 360;
    points.push(computeDestination(originLat, originLon, originRadiusKm * radiusScale, brng));
  }

  // 2. Left tangent boundary along each forecast step
  trackPoints.forEach((tp) => {
    points.push(computeDestination(tp.lat, tp.lon, tp.radiusKm * radiusScale, leftPerp));
  });

  // 3. Smooth 180-degree rounded forward arc cap around the terminal forecast point
  const lastTp = trackPoints[trackPoints.length - 1];
  for (let a = -80; a <= 80; a += 10) {
    const brng = (headingDeg + a + 360) % 360;
    points.push(computeDestination(lastTp.lat, lastTp.lon, lastTp.radiusKm * radiusScale, brng));
  }

  // 4. Right tangent boundary back from terminal point to origin
  for (let i = trackPoints.length - 1; i >= 0; i--) {
    const tp = trackPoints[i];
    points.push(computeDestination(tp.lat, tp.lon, tp.radiusKm * radiusScale, rightPerp));
  }

  return points;
}

// Builds a curved transverse arrival front arc across the storm track cone at a specific time step
function buildIsochroneArcPath(
  lat: number,
  lon: number,
  radiusKm: number,
  headingDeg: number,
  scale: number = 0.85
): google.maps.LatLngLiteral[] {
  const arc: google.maps.LatLngLiteral[] = [];
  for (let a = -72; a <= 72; a += 12) {
    const brng = (headingDeg + a + 360) % 360;
    arc.push(computeDestination(lat, lon, radiusKm * scale, brng));
  }
  return arc;
}

// Builds the real-time astronomical Day/Night Solar Terminator curve and night shadow polygon
function buildSolarTerminatorGeometry(
  subsolarLat: number,
  subsolarLon: number
): {
  terminatorLine: google.maps.LatLngLiteral[];
  nightPolygon: google.maps.LatLngLiteral[];
} {
  const decRad = (subsolarLat * Math.PI) / 180;
  // Avoid tan(0) singularity near equinoxes
  const safeTanDec =
    Math.abs(Math.tan(decRad)) < 0.0001
      ? decRad >= 0
        ? 0.0001
        : -0.0001
      : Math.tan(decRad);

  const terminatorLine: google.maps.LatLngLiteral[] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const haRad = ((lon - subsolarLon) * Math.PI) / 180;
    const latRad = Math.atan(-Math.cos(haRad) / safeTanDec);
    const latDeg = Math.max(-85, Math.min(85, (latRad * 180) / Math.PI));
    terminatorLine.push({ lat: Number(latDeg.toFixed(3)), lng: lon });
  }

  // Night side pole: if subsolarLat >= 0 (Northern summer), South Pole (-85) is in darkness; else North Pole (+85)
  const nightPoleLat = subsolarLat >= 0 ? -85 : 85;
  const nightPolygon: google.maps.LatLngLiteral[] = [
    { lat: nightPoleLat, lng: -180 },
    ...terminatorLine,
    { lat: nightPoleLat, lng: 180 },
  ];

  return { terminatorLine, nightPolygon };
}

function formatEtaUtc(minOffset: number): string {
  const d = new Date(Date.now() + minOffset * 60000);
  return `${d.toISOString().slice(11, 16)}Z`;
}

// Isolated Real-Time Cursor Spatial Probe Readout (Prevents parent MultiSensorMap re-renders on mousemove)
const GlmSpatialProbeReadout: React.FC<{
  subscribeProbe: (cb: (probe: GlmCursorProbeTelemetry | null) => void) => () => void;
}> = ({ subscribeProbe }) => {
  const [probe, setProbe] = useState<GlmCursorProbeTelemetry | null>(null);

  useEffect(() => {
    return subscribeProbe(setProbe);
  }, [subscribeProbe]);

  if (!probe) {
    return (
      <div className="text-[9.5px] text-slate-400">
        Hover map to probe live GLM FED · TOE · MFA · σ-Jump
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[9.5px] bg-[#080C14]/90 px-2 py-0.5 rounded border border-slate-800">
      <span className="text-slate-400">
        PROBE ({probe.lat}°, {probe.lon}°):
      </span>
      <span className="text-amber-300 font-bold">
        FED {probe.fedFlPerMin} fl/m
      </span>
      <span className="text-fuchsia-300 font-bold">
        TOE {probe.toeFemtoJoules} fJ
      </span>
      {probe.minFlashAreaKm2 > 0 && (
        <span className="text-cyan-300">
          MFA {probe.minFlashAreaKm2} km²
        </span>
      )}
      <span
        className={`font-bold ${
          probe.jumpSigma >= 2.0
            ? 'text-rose-400'
            : probe.jumpSigma >= 1.0
            ? 'text-amber-300'
            : 'text-emerald-400'
        }`}
      >
        {probe.jumpSigma >= 2.0 ? `+${probe.jumpSigma}σ JUMP` : `${probe.jumpSigma}σ`}
      </span>
    </div>
  );
};

const MapOverlaysController: React.FC<{
  bundle: ObservationBundle | null;
  nowcast?: AiNowcastResult | null;
  layers: MapLayerState;
  glmConfig: GlmHeatmapConfig;
  activeRadarFrameIndex: number;
  selectedNowcastMinute: number;
  selectedCellId: string | null;
  onSelectCell: (cell: ConvectiveCell) => void;
  onSelectNowcastMinute?: (min: number) => void;
  showEnsembleFan: boolean;
  showBunkersSplit: boolean;
  focusCellTrigger: number;
  focusGlmPeakTrigger: number;
  onZoomChanged: (zoom: number) => void;
  onEmitCursorProbe: (probe: GlmCursorProbeTelemetry | null) => void;
}> = ({
  bundle,
  nowcast,
  layers,
  glmConfig,
  activeRadarFrameIndex,
  selectedNowcastMinute,
  selectedCellId,
  onSelectCell,
  onSelectNowcastMinute,
  showEnsembleFan,
  showBunkersSplit,
  focusCellTrigger,
  focusGlmPeakTrigger,
  onZoomChanged,
  onEmitCursorProbe,
}) => {
  const map = useMap();
  const vectorShapesRef = useRef<
    Array<google.maps.Circle | google.maps.Polyline | google.maps.Polygon>
  >([]);
  const isInteractingRef = useRef<boolean>(false);

  // Fixed 5-Slot Overlay Architecture so changing 1 layer or map mode NEVER reloads other layers:
  // Slot 0: High-DPI Custom Base Map (TERRAIN_TOPO or LIGHT_DAY; null for native DARK/HYBRID/SAT)
  // Slot 1: GOES/IR Satellite Layer
  // Slot 2: Composite Weather Radar Layer (512px Retina)
  // Slot 3: NOAA NEXRAD Hi-Res Layer
  // Slot 4: GOES-R GLM Gridded Flash Heatmap Layer
  const slotsInitializedRef = useRef<boolean>(false);
  const satLayerRef = useRef<UpdatableTileMapType | null>(null);
  const radarLayerRef = useRef<UpdatableTileMapType | null>(null);
  const glmLayerRef = useRef<UpdatableTileMapType | null>(null);

  const ensureOverlaySlots = (targetMap: google.maps.Map) => {
    if (!slotsInitializedRef.current || targetMap.overlayMapTypes.getLength() < 5) {
      targetMap.overlayMapTypes.clear();
      for (let i = 0; i < 5; i++) {
        targetMap.overlayMapTypes.push(null as unknown as google.maps.MapType);
      }
      slotsInitializedRef.current = true;
    }
  };

  // Preload center sector radar & satellite tiles across frames into GLOBAL_TILE_IMAGE_CACHE for 0ms zoom & loop
  useEffect(() => {
    if (!bundle) return;
    const z = 7;
    const n = 1 << z;
    const x = Math.floor(((bundle.location.lon + 180) / 360) * n);
    const latRad = (bundle.location.lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );

    // Preload 3x3 neighborhood at Z7 for all radar frames so loop & overzoom are 100% instant
    bundle.radarFrames.slice(-6).forEach((frame) => {
      if (!frame.path) return;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const tx = ((x + dx) % n + n) % n;
          const ty = Math.max(0, Math.min(n - 1, y + dy));
          fetchAndCacheTileImage(
            `${bundle.radarTileHost}${frame.path}/512/${z}/${tx}/${ty}/2/1_1.png`
          ).catch(() => {});
        }
      }
    });
  }, [bundle]);

  // Slot 0 & Native MapTypeId: Instantaneous 0ms switching across all 6 Base Map Modes (including AUTO_DAY_NIGHT)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    ensureOverlaySlots(map);

    const rawMode: BaseMapMode = layers.baseMapMode || 'DARK_TACTICAL';
    const isSectorDay = bundle?.diurnal ? bundle.diurnal.isDay : true;
    const mode: BaseMapMode =
      rawMode === 'AUTO_DAY_NIGHT'
        ? isSectorDay
          ? 'LIGHT_DAY'
          : 'DARK_TACTICAL'
        : rawMode;

    if (mode === 'HYBRID_SAT') {
      map.overlayMapTypes.setAt(0, null as unknown as google.maps.MapType);
      map.setMapTypeId('hybrid');
    } else if (mode === 'SATELLITE_RAW') {
      map.overlayMapTypes.setAt(0, null as unknown as google.maps.MapType);
      map.setMapTypeId('satellite');
    } else if (mode === 'TERRAIN_TOPO') {
      map.setMapTypeId('terrain');
      const topoBaseLayer = createOverzoomTileMapType({
        name: 'Topographic Relief & Elevation Contours',
        opacity: 1.0,
        minNativeZoom: 2,
        maxNativeZoom: 18,
        getNativeTileUrl: (x, y, z) =>
          `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
      });
      map.overlayMapTypes.setAt(0, topoBaseLayer);
    } else if (mode === 'LIGHT_DAY') {
      map.setMapTypeId('roadmap');
      const lightRetinaLayer = createOverzoomTileMapType({
        name: 'Daylight High-Contrast Retina Basemap',
        opacity: 1.0,
        minNativeZoom: 2,
        maxNativeZoom: 18,
        getNativeTileUrl: (x, y, z) => {
          const sub = ['a', 'b', 'c', 'd'][(x + y) % 4];
          return `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`;
        },
      });
      map.overlayMapTypes.setAt(0, lightRetinaLayer);
    } else {
      // DARK_TACTICAL: Native Google Dark Vector Basemap
      map.overlayMapTypes.setAt(0, null as unknown as google.maps.MapType);
      map.setMapTypeId('roadmap');
    }
  }, [map, layers.baseMapMode, bundle?.diurnal?.isDay]);

  // Listen to zoom & drag states for integer-snapped UI telemetry without mid-gesture lag
  useEffect(() => {
    if (!map) return;
    let lastIntZoom = Math.round(map.getZoom() ?? 7);

    const zListener = map.addListener('zoom_changed', () => {
      isInteractingRef.current = true;
      const z = map.getZoom();
      if (typeof z === 'number') {
        const rounded = Math.round(z);
        if (rounded !== lastIntZoom) {
          lastIntZoom = rounded;
          onZoomChanged(rounded);
        }
      }
    });
    const dragStartListener = map.addListener('dragstart', () => {
      isInteractingRef.current = true;
    });
    const idleListener = map.addListener('idle', () => {
      isInteractingRef.current = false;
      const z = map.getZoom();
      if (typeof z === 'number') {
        const rounded = Math.round(z);
        if (rounded !== lastIntZoom) {
          lastIntZoom = rounded;
          onZoomChanged(rounded);
        }
      }
    });

    return () => {
      zListener.remove();
      dragStartListener.remove();
      idleListener.remove();
    };
  }, [map, onZoomChanged]);

  // Real-time GLM Spatial Cursor Probe throttled via requestAnimationFrame & paused during pan/zoom
  useEffect(() => {
    if (!map || !bundle || !layers.lightningHeatmap) {
      onEmitCursorProbe(null);
      return;
    }
    let rafId: number | null = null;
    let pendingLat = 0;
    let pendingLon = 0;

    const moveListener = map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng || isInteractingRef.current) return;
      pendingLat = e.latLng.lat();
      pendingLon = e.latLng.lng();

      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const probe = evaluateGlmPointTelemetry(
          pendingLat,
          pendingLon,
          bundle,
          nowcast,
          selectedNowcastMinute,
          glmConfig
        );
        onEmitCursorProbe(probe);
      });
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      moveListener.remove();
    };
  }, [
    map,
    bundle,
    nowcast,
    layers.lightningHeatmap,
    selectedNowcastMinute,
    glmConfig,
    onEmitCursorProbe,
  ]);

  // Re-center map smoothly when bundle location changes
  const lastLocationRef = useRef<string>('');
  useEffect(() => {
    if (!map || !bundle) return;
    const locKey = `${bundle.location.lat.toFixed(3)},${bundle.location.lon.toFixed(3)}`;
    if (lastLocationRef.current !== locKey) {
      lastLocationRef.current = locKey;
      map.panTo({ lat: bundle.location.lat, lng: bundle.location.lon });
      const currentZoom = map.getZoom() ?? 7;
      if (currentZoom < 6 || currentZoom > 9) {
        map.setZoom(7);
      }
    }
  }, [map, bundle]);

  // Focus & Frame active cell's 0-120m track cone when user clicks "Focus Cone"
  useEffect(() => {
    if (!map || !bundle || focusCellTrigger === 0 || !window.google?.maps) return;
    const cell =
      bundle.convectiveCells.find((c) => c.id === selectedCellId) ||
      bundle.convectiveCells[0];
    if (!cell) return;

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: cell.lat, lng: cell.lon });
    cell.trackForecast.forEach((tf) => {
      const n = computeDestination(tf.lat, tf.lon, tf.radiusKm * 1.3, 0);
      const s = computeDestination(tf.lat, tf.lon, tf.radiusKm * 1.3, 180);
      const e = computeDestination(tf.lat, tf.lon, tf.radiusKm * 1.3, 90);
      const w = computeDestination(tf.lat, tf.lon, tf.radiusKm * 1.3, 270);
      bounds.extend(n);
      bounds.extend(s);
      bounds.extend(e);
      bounds.extend(w);
    });
    map.fitBounds(bounds, { top: 90, bottom: 110, left: 380, right: 410 });
  }, [map, bundle, selectedCellId, focusCellTrigger]);

  // Focus & Lock onto Peak GLM Lightning Jump Core when user clicks "PEAK CORE"
  useEffect(() => {
    if (!map || !bundle || focusGlmPeakTrigger === 0 || !window.google?.maps) return;
    const peakCell = [...bundle.convectiveCells].sort(
      (a, b) => b.flashRatePerMin - a.flashRatePerMin
    )[0];
    if (!peakCell) return;
    onSelectCell(peakCell);
    map.panTo({ lat: peakCell.lat, lng: peakCell.lon });
    const z = map.getZoom() ?? 7;
    if (z < 8) {
      map.setZoom(8);
    }
  }, [map, bundle, focusGlmPeakTrigger, onSelectCell]);

  // Slot 1: Global Satellite Infrared Layer (Independent Lifecycle)
  const satFramePath =
    bundle && bundle.satelliteFrames.length > 0
      ? bundle.satelliteFrames[
          Math.min(bundle.satelliteFrames.length - 1, Math.max(0, activeRadarFrameIndex))
        ]?.path
      : null;

  useEffect(() => {
    if (!map || !window.google?.maps) return;
    ensureOverlaySlots(map);

    if (!layers.satellite || !bundle || !satFramePath) {
      satLayerRef.current = null;
      map.overlayMapTypes.setAt(1, null as unknown as google.maps.MapType);
      return;
    }

    const isGibsFallback = satFramePath === 'GIBS_GOES_IR_CLEAN';
    const isAmericas = bundle.location.lon >= -165 && bundle.location.lon <= -20;

    const satMapType = createOverzoomTileMapType({
      name: 'GOES/IR Satellite',
      opacity: layers.satelliteOpacity,
      minNativeZoom: 1,
      maxNativeZoom: 6,
      getNativeTileUrl: (x, y, z) => {
        if (!isGibsFallback) {
          return `${bundle.radarTileHost}${satFramePath}/512/${z}/${x}/${y}/0/0_0.png`;
        }
        if (isAmericas) {
          return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`;
        }
        return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/default/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`;
      },
    });

    satLayerRef.current = satMapType;
    map.overlayMapTypes.setAt(1, satMapType);
  }, [map, layers.satellite, satFramePath, bundle?.radarTileHost, bundle?.location.lon]);

  // Instant 0ms Satellite Opacity Adjustment (No Tile Reload)
  useEffect(() => {
    satLayerRef.current?.setOpacity(layers.satelliteOpacity);
  }, [layers.satelliteOpacity]);

  // Slot 2: Global Composite Weather Radar Layer (512px Retina + Independent Lifecycle)
  const radarFramePath =
    bundle && bundle.radarFrames.length > 0
      ? bundle.radarFrames[
          Math.min(bundle.radarFrames.length - 1, Math.max(0, activeRadarFrameIndex))
        ]?.path
      : null;

  useEffect(() => {
    if (!map || !window.google?.maps) return;
    ensureOverlaySlots(map);

    if (!layers.radar || !bundle || !radarFramePath) {
      radarLayerRef.current = null;
      map.overlayMapTypes.setAt(2, null as unknown as google.maps.MapType);
      return;
    }

    const radarMapType = createOverzoomTileMapType({
      name: 'Composite Radar Reflectivity (512px HiDPI)',
      opacity: layers.radarOpacity,
      minNativeZoom: 2,
      maxNativeZoom: 7,
      getNativeTileUrl: (x, y, z) =>
        `${bundle.radarTileHost}${radarFramePath}/512/${z}/${x}/${y}/2/1_1.png`,
    });

    radarLayerRef.current = radarMapType;
    map.overlayMapTypes.setAt(2, radarMapType);
  }, [map, layers.radar, radarFramePath, bundle?.radarTileHost]);

  // Instant 0ms Radar Opacity Adjustment (No Tile Reload)
  useEffect(() => {
    radarLayerRef.current?.setOpacity(layers.radarOpacity);
  }, [layers.radarOpacity]);

  // Slot 3: High-Res US NEXRAD Base Reflectivity (Native Z2..Z12 + Independent Lifecycle)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    ensureOverlaySlots(map);

    if (!layers.nexradHiRes) {
      map.overlayMapTypes.setAt(3, null as unknown as google.maps.MapType);
      return;
    }

    const nexradMapType = createOverzoomTileMapType({
      name: 'NOAA NEXRAD N0Q Base Reflectivity',
      opacity: 0.82,
      minNativeZoom: 2,
      maxNativeZoom: 12,
      getNativeTileUrl: (x, y, z) =>
        `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${z}/${x}/${y}.png`,
    });

    map.overlayMapTypes.setAt(3, nexradMapType);
  }, [map, layers.nexradHiRes]);

  // Slot 4: GOES-R GLM Gridded Lightning Flash Heatmap Layer (Independent Lifecycle)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    ensureOverlaySlots(map);

    if (!layers.lightningHeatmap || !bundle) {
      glmLayerRef.current = null;
      map.overlayMapTypes.setAt(4, null as unknown as google.maps.MapType);
      return;
    }

    const glmHeatmapMapType = createGlmFlashDensityHeatmapMapType(
      bundle,
      selectedNowcastMinute,
      nowcast,
      glmConfig
    );
    glmLayerRef.current = glmHeatmapMapType;
    map.overlayMapTypes.setAt(4, glmHeatmapMapType);
  }, [
    map,
    bundle,
    nowcast,
    layers.lightningHeatmap,
    selectedNowcastMinute,
    glmConfig.productMode,
    glmConfig.polarityFilter,
    glmConfig.timeWindowMin,
    glmConfig.radiusScale,
    glmConfig.showContours,
    glmConfig.includeAdvected,
  ]);

  // Instant 0ms GLM Heatmap Opacity Adjustment (No Tile Regeneration)
  useEffect(() => {
    glmLayerRef.current?.setOpacity(glmConfig.opacity);
  }, [glmConfig.opacity]);

  // Manage Vector Geometry Overlays (Multi-Radar Range Rings, GLM Iso-FED Contours & AI Track Cones)
  useEffect(() => {
    if (!map || !bundle || !window.google?.maps) return;

    // Clear previous shapes
    vectorShapesRef.current.forEach((shape) => shape.setMap(null));
    vectorShapesRef.current = [];

    // 0. Geodesic Anisotropic GLM Iso-FED Electrification Contours (strictly when real electrification is active)
    if (layers.lightningHeatmap && glmConfig.showContours) {
      bundle.convectiveCells.forEach((cell) => {
        if (cell.flashRatePerMin <= 0) return;
        const isSelected = cell.id === (selectedCellId || bundle.convectiveCells[0]?.id);
        const scale = glmConfig.radiusScale;

        // Outer 5 fl/min Anvil Electrification Boundary (Dashed Cyan/Amber)
        const outerAnvilPath = buildAnisotropicGlmContourPath(
          cell.lat,
          cell.lon,
          18 * scale,
          30 * scale,
          cell.headingDeg
        );
        const outerContour = new google.maps.Polyline({
          map,
          path: [...outerAnvilPath, outerAnvilPath[0]],
          strokeOpacity: 0,
          icons: [
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: isSelected ? 0.65 : 0.35,
                strokeColor: '#38BDF8',
                scale: 2.2,
              },
              offset: '0',
              repeat: '10px',
            },
          ],
          clickable: false,
          zIndex: 9,
        });
        vectorShapesRef.current.push(outerContour);

        // Inner 20+ fl/min 2-Sigma Lightning Jump Core Contour (Solid/Glowing Orange-Rose)
        if (cell.flashRatePerMin >= 8) {
          const jumpCorePath = buildAnisotropicGlmContourPath(
            cell.lat,
            cell.lon,
            9.5 * scale,
            15 * scale,
            cell.headingDeg
          );
          const jumpPoly = new google.maps.Polygon({
            map,
            paths: jumpCorePath,
            strokeColor: '#F97316',
            strokeOpacity: isSelected ? 0.9 : 0.55,
            strokeWeight: isSelected ? 1.8 : 1.2,
            fillColor: '#F43F5E',
            fillOpacity: 0.08,
            clickable: true,
            zIndex: 14,
          });
          jumpPoly.addListener('click', () => onSelectCell(cell));
          vectorShapesRef.current.push(jumpPoly);
        }
      });
    }

    // 1. Multi-Radar Coverage Rings & Line-of-Sight Beams
    if (layers.radarBeams) {
      bundle.radarStations.forEach((st, idx) => {
        const rangeCircle = new google.maps.Circle({
          map,
          center: { lat: st.lat, lng: st.lon },
          radius: 140000,
          strokeColor: idx === 0 ? '#38BDF8' : '#64748B',
          strokeOpacity: idx === 0 ? 0.55 : 0.3,
          strokeWeight: 1,
          fillColor: '#38BDF8',
          fillOpacity: idx === 0 ? 0.04 : 0.015,
          clickable: false,
        });
        vectorShapesRef.current.push(rangeCircle);

        const target =
          bundle.convectiveCells.find((c) => c.id === selectedCellId) ||
          bundle.convectiveCells[0] ||
          bundle.location;
        const beamLine = new google.maps.Polyline({
          map,
          path: [
            { lat: st.lat, lng: st.lon },
            { lat: target.lat, lng: target.lon },
          ],
          strokeColor: idx === 0 ? '#38BDF8' : '#94A3B8',
          strokeOpacity: 0.65,
          strokeWeight: idx === 0 ? 1.8 : 1.2,
          clickable: false,
        });
        vectorShapesRef.current.push(beamLine);
      });
    }

    // 2. Upgraded AI Nowcast Extrapolation Cones, Ensemble Fan, Active Swath & Isochrones
    if (layers.nowcastCones) {
      bundle.convectiveCells.forEach((cell) => {
        const isSelected = cell.id === (selectedCellId || bundle.convectiveCells[0]?.id);
        const isSevere =
          cell.severity === 'TORNADIC_SUPERCELL' || cell.severity === 'SEVERE';
        const isStrong = cell.severity === 'STRONG';

        const primaryColor = isSevere
          ? '#F43F5E'
          : isStrong
          ? '#F59E0B'
          : '#38BDF8';

        const accentColor = isSevere
          ? '#FDA4AF'
          : isStrong
          ? '#FDE68A'
          : '#BAE6FD';

        if (cell.trackForecast.length > 0) {
          // A. Outer 90% Ensemble Spread Uncertainty Cone (1-sigma / 2-sigma lateral dispersion)
          if (showEnsembleFan) {
            const outerFanPath = buildSmoothStormConePath(
              cell.lat,
              cell.lon,
              4.2,
              cell.trackForecast,
              cell.headingDeg,
              1.32
            );
            const outerFanPoly = new google.maps.Polygon({
              map,
              paths: outerFanPath,
              strokeColor: primaryColor,
              strokeOpacity: isSelected ? 0.35 : 0.18,
              strokeWeight: 1,
              fillColor: primaryColor,
              fillOpacity: isSelected ? 0.07 : 0.03,
              clickable: true,
              zIndex: isSelected ? 12 : 6,
            });
            outerFanPoly.addListener('click', () => onSelectCell(cell));
            vectorShapesRef.current.push(outerFanPoly);

            // Dashed ensemble boundary line
            const dashedSymbol: google.maps.Symbol = {
              path: 'M 0,-1 0,1',
              strokeOpacity: isSelected ? 0.55 : 0.25,
              strokeColor: accentColor,
              scale: 2.5,
            };
            const outerOutline = new google.maps.Polyline({
              map,
              path: [...outerFanPath, outerFanPath[0]],
              strokeOpacity: 0,
              icons: [
                {
                  icon: dashedSymbol,
                  offset: '0',
                  repeat: '12px',
                },
              ],
              clickable: false,
              zIndex: isSelected ? 13 : 7,
            });
            vectorShapesRef.current.push(outerOutline);
          }

          // B. Inner 50% High-Probability Core Threat Cone (Full 0-120m Swath)
          const coreConePath = buildSmoothStormConePath(
            cell.lat,
            cell.lon,
            3.5,
            cell.trackForecast,
            cell.headingDeg,
            0.85
          );
          const coreConePoly = new google.maps.Polygon({
            map,
            paths: coreConePath,
            strokeColor: primaryColor,
            strokeOpacity: isSelected ? 0.88 : 0.45,
            strokeWeight: isSelected ? 1.8 : 1.1,
            fillColor: primaryColor,
            fillOpacity: isSelected ? 0.16 : 0.08,
            clickable: true,
            zIndex: isSelected ? 16 : 8,
          });
          coreConePoly.addListener('click', () => onSelectCell(cell));
          vectorShapesRef.current.push(coreConePoly);

          // C. Active Lead-Time Illuminated Swath Corridor (0m -> selectedNowcastMinute)
          const activeSteps = cell.trackForecast.filter(
            (tf) => tf.minOffset <= selectedNowcastMinute
          );
          if (activeSteps.length > 0 && isSelected) {
            const activeSwathPath = buildSmoothStormConePath(
              cell.lat,
              cell.lon,
              3.5,
              activeSteps,
              cell.headingDeg,
              0.85
            );
            const activeSwathPoly = new google.maps.Polygon({
              map,
              paths: activeSwathPath,
              strokeColor: accentColor,
              strokeOpacity: 0.95,
              strokeWeight: 2.2,
              fillColor: primaryColor,
              fillOpacity: 0.28,
              clickable: true,
              zIndex: 20,
            });
            activeSwathPoly.addListener('click', () => onSelectCell(cell));
            vectorShapesRef.current.push(activeSwathPoly);
          }

          // D. Central Advection Spine with Directional Motion Arrows
          const arrowSymbol: google.maps.Symbol = {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: isSelected ? 3.2 : 2.4,
            strokeColor: '#080C14',
            strokeWeight: 1,
            fillColor: isSelected ? '#F8FAFC' : primaryColor,
            fillOpacity: 1,
          };

          const trackSpine = new google.maps.Polyline({
            map,
            path: [
              { lat: cell.lat, lng: cell.lon },
              ...cell.trackForecast.map((t) => ({ lat: t.lat, lng: t.lon })),
            ],
            strokeColor: isSelected ? '#F8FAFC' : primaryColor,
            strokeOpacity: isSelected ? 0.95 : 0.65,
            strokeWeight: isSelected ? 2.2 : 1.5,
            icons: [
              {
                icon: arrowSymbol,
                offset: '22%',
                repeat: '28%',
              },
            ],
            clickable: true,
            zIndex: isSelected ? 24 : 11,
          });
          trackSpine.addListener('click', () => onSelectCell(cell));
          vectorShapesRef.current.push(trackSpine);

          // E. Bunkers Right-Mover (+16°) & Left-Mover (-16°) Supercell Split Trajectories
          if (showBunkersSplit && isSelected) {
            const totalDistKm = (cell.speedKmh * 120) / 60;
            const rightSplitEnd = computeDestination(
              cell.lat,
              cell.lon,
              totalDistKm * 0.92,
              (cell.headingDeg + 16) % 360
            );
            const leftSplitEnd = computeDestination(
              cell.lat,
              cell.lon,
              totalDistKm * 1.05,
              (cell.headingDeg - 16 + 360) % 360
            );

            const rightLine = new google.maps.Polyline({
              map,
              path: [{ lat: cell.lat, lng: cell.lon }, rightSplitEnd],
              strokeColor: '#F43F5E',
              strokeOpacity: 0.85,
              strokeWeight: 1.6,
              icons: [
                {
                  icon: {
                    path: google.maps.SymbolPath.FORWARD_OPEN_ARROW,
                    scale: 2.6,
                    strokeColor: '#F43F5E',
                  },
                  offset: '100%',
                },
              ],
              clickable: false,
              zIndex: 23,
            });
            const leftLine = new google.maps.Polyline({
              map,
              path: [{ lat: cell.lat, lng: cell.lon }, leftSplitEnd],
              strokeColor: '#38BDF8',
              strokeOpacity: 0.75,
              strokeWeight: 1.4,
              icons: [
                {
                  icon: {
                    path: google.maps.SymbolPath.FORWARD_OPEN_ARROW,
                    scale: 2.4,
                    strokeColor: '#38BDF8',
                  },
                  offset: '100%',
                },
              ],
              clickable: false,
              zIndex: 23,
            });
            vectorShapesRef.current.push(rightLine, leftLine);
          }

          // F. Transverse Isochrone Wavefront Arcs & Selected Lead-Time Target Footprint
          cell.trackForecast.forEach((tf) => {
            const isHighlighted = tf.minOffset === selectedNowcastMinute;

            // Transverse curved wavefront line across the cone
            const arcPoints = buildIsochroneArcPath(
              tf.lat,
              tf.lon,
              tf.radiusKm,
              cell.headingDeg,
              0.85
            );
            const isoArc = new google.maps.Polyline({
              map,
              path: arcPoints,
              strokeColor: isHighlighted ? '#F8FAFC' : accentColor,
              strokeOpacity: isHighlighted ? 0.98 : isSelected ? 0.55 : 0.28,
              strokeWeight: isHighlighted ? 2.5 : 1.2,
              clickable: true,
              zIndex: isHighlighted ? 26 : 15,
            });
            isoArc.addListener('click', () => {
              onSelectCell(cell);
              onSelectNowcastMinute?.(tf.minOffset);
            });
            vectorShapesRef.current.push(isoArc);

            // Highlighted projected core footprint circle at selectedNowcastMinute
            if (isHighlighted) {
              const targetFootprint = new google.maps.Circle({
                map,
                center: { lat: tf.lat, lng: tf.lon },
                radius: tf.radiusKm * 850,
                strokeColor: '#F8FAFC',
                strokeOpacity: 0.95,
                strokeWeight: 2,
                fillColor: primaryColor,
                fillOpacity: isSelected ? 0.32 : 0.16,
                clickable: true,
                zIndex: 25,
              });
              targetFootprint.addListener('click', () => {
                onSelectCell(cell);
                onSelectNowcastMinute?.(tf.minOffset);
              });
              vectorShapesRef.current.push(targetFootprint);
            }
          });
        }
      });
    }

    // 3. Real-Time Astronomical Solar Terminator Geodesic Curve & Night-Side Twilight Envelope
    if (layers.solarTerminator !== false && bundle.diurnal) {
      const { terminatorLine, nightPolygon } = buildSolarTerminatorGeometry(
        bundle.diurnal.subsolarLat,
        bundle.diurnal.subsolarLon
      );

      const nightShadowPoly = new google.maps.Polygon({
        map,
        paths: nightPolygon,
        strokeWeight: 0,
        fillColor: '#020617',
        fillOpacity: 0.28,
        clickable: false,
        zIndex: 4,
      });

      const terminatorCurve = new google.maps.Polyline({
        map,
        path: terminatorLine,
        geodesic: false,
        strokeColor: '#F59E0B',
        strokeOpacity: 0.75,
        strokeWeight: 1.75,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 0.85,
              strokeColor: '#FDE047',
              scale: 2.4,
            },
            offset: '0',
            repeat: '14px',
          },
        ],
        clickable: false,
        zIndex: 11,
      });

      vectorShapesRef.current.push(nightShadowPoly, terminatorCurve);
    }

    return () => {
      vectorShapesRef.current.forEach((shape) => shape.setMap(null));
      vectorShapesRef.current = [];
    };
  }, [
    map,
    bundle,
    layers.radarBeams,
    layers.nowcastCones,
    layers.lightningHeatmap,
    layers.solarTerminator,
    glmConfig,
    selectedNowcastMinute,
    selectedCellId,
    showEnsembleFan,
    showBunkersSplit,
    onSelectCell,
    onSelectNowcastMinute,
  ]);

  return null;
};

const MapZoomControls: React.FC<{
  currentZoom: number;
  bundle: ObservationBundle | null;
  baseMapMode: BaseMapMode;
  solarTerminatorEnabled?: boolean;
  onSelectBaseMapMode?: (mode: BaseMapMode) => void;
  onToggleSolarTerminator?: () => void;
}> = ({
  currentZoom,
  bundle,
  baseMapMode,
  solarTerminatorEnabled = true,
  onSelectBaseMapMode,
  onToggleSolarTerminator,
}) => {
  const map = useMap();
  const intZoom = Math.round(currentZoom);

  const handleZoom = (delta: number) => {
    if (!map) return;
    const z = Math.round(map.getZoom() ?? 7);
    map.setZoom(Math.max(2, Math.min(18, z + delta)));
  };

  const handleSetExactZoom = (targetZoom: number) => {
    if (!map) return;
    map.setZoom(targetZoom);
  };

  const handleResetSector = () => {
    if (!map || !bundle) return;
    map.panTo({ lat: bundle.location.lat, lng: bundle.location.lon });
    map.setZoom(7);
  };

  const isOverzoomed = intZoom > 7;
  const overzoomScale = isOverzoomed ? 1 << (intZoom - 7) : 1;

  return (
    <div className="absolute bottom-20 right-4 z-20 pointer-events-auto flex flex-col items-end gap-1.5">
      {/* Real-Time Sector Diurnal Solar & Day/Night Status Bar */}
      {bundle?.diurnal && (
        <div className="bg-[#0F1622]/94 backdrop-blur-md border border-slate-800/90 rounded-md px-2 py-1 shadow-xl flex items-center gap-1.5 font-mono text-[9px]">
          {bundle.diurnal.isDay ? (
            <Sun className="w-3 h-3 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-3 h-3 text-indigo-400 shrink-0" />
          )}
          <span
            className={
              bundle.diurnal.isDay
                ? 'text-amber-300 font-bold'
                : 'text-indigo-300 font-bold'
            }
          >
            {bundle.diurnal.isDay ? 'REAL-TIME DAY' : 'REAL-TIME NIGHT'}
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-200">{bundle.diurnal.localTimeFormatted}</span>
          <span className="text-slate-400">
            (Sun {bundle.diurnal.solarElevationDeg > 0 ? '+' : ''}
            {bundle.diurnal.solarElevationDeg}°)
          </span>
          {onToggleSolarTerminator && (
            <button
              onClick={onToggleSolarTerminator}
              className={`ml-1 px-1.5 py-0.2 rounded border transition-colors cursor-pointer ${
                solarTerminatorEnabled
                  ? 'bg-amber-500/20 border-amber-400/70 text-amber-200 font-bold'
                  : 'bg-[#080C14] border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
              title="Toggle Real-Time Astronomical Day/Night Solar Terminator Overlay"
            >
              TERMINATOR
            </button>
          )}
        </div>
      )}

      {/* On-Map Base Cartography Mode Selector */}
      {onSelectBaseMapMode && (
        <div className="bg-[#0F1622]/94 backdrop-blur-md border border-slate-800/90 rounded-md p-1 shadow-xl flex items-center gap-1 font-mono text-[9px]">
          <span className="text-slate-400 px-1 font-bold">MAP MODE:</span>
          {(
            [
              {
                id: 'AUTO_DAY_NIGHT',
                label: 'AUTO D/N',
                tip: 'Real-Time Solar Synchronized Map (Daylight Retina in Local Day / Dark Tactical in Local Night)',
              },
              { id: 'DARK_TACTICAL', label: 'DARK', tip: 'Dark Tactical Vector Basemap' },
              { id: 'HYBRID_SAT', label: 'HYBRID', tip: 'Satellite + Cities & Highways' },
              { id: 'SATELLITE_RAW', label: 'SAT', tip: 'Pure High-Res Satellite Imagery' },
              { id: 'TERRAIN_TOPO', label: 'TERRAIN', tip: 'Topographic Relief & Contours' },
              { id: 'LIGHT_DAY', label: 'LIGHT', tip: 'Daylight Retina @2x Roadmap' },
            ] as const
          ).map((m) => {
            const active = baseMapMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onSelectBaseMapMode(m.id)}
                title={m.tip}
                className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                  active
                    ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-bold shadow-sm shadow-sky-500/20'
                    : 'bg-[#080C14]/85 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Tactical Zoom Presets (Instant Integer Zoom Snap) */}
      <div className="bg-[#0F1622]/92 backdrop-blur-md border border-slate-800/90 rounded-md p-1 shadow-xl hidden sm:flex items-center gap-1 font-mono text-[9px]">
        <span className="text-slate-500 px-1">SCALE:</span>
        {[
          { z: 5, label: 'Z5 SYNOPTIC' },
          { z: 7, label: 'Z7 SECTOR' },
          { z: 9, label: 'Z9 MESO' },
          { z: 11, label: 'Z11 STORM' },
          { z: 13, label: 'Z13 CORE' },
        ].map((preset) => (
          <button
            key={preset.z}
            onClick={() => handleSetExactZoom(preset.z)}
            className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
              intZoom === preset.z
                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 font-bold'
                : 'bg-[#080C14]/80 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="bg-[#0F1622]/90 backdrop-blur-md border border-slate-800/90 rounded-md px-2 py-1 text-[9.5px] font-mono text-slate-300 shadow-xl flex items-center gap-1.5">
        <span className="text-slate-500">ZOOM</span>
        <span className="text-sky-400 font-bold">Z{intZoom}</span>
        {isOverzoomed ? (
          <span className="px-1 py-0.2 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
            {overzoomScale}x HiDPI
          </span>
        ) : (
          <span className="px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            512px RETINA
          </span>
        )}
      </div>

      <div className="bg-[#0F1622]/90 backdrop-blur-md border border-slate-800/90 rounded-md shadow-xl flex flex-col overflow-hidden">
        <button
          onClick={() => handleZoom(1)}
          className="p-2 hover:bg-slate-800 text-slate-200 hover:text-sky-400 border-b border-slate-800/90 transition-colors cursor-pointer"
          title="Zoom In (+1 Integer Level)"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleZoom(-1)}
          className="p-2 hover:bg-slate-800 text-slate-200 hover:text-sky-400 border-b border-slate-800/90 transition-colors cursor-pointer"
          title="Zoom Out (-1 Integer Level)"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleResetSector}
          className="p-2 hover:bg-slate-800 text-slate-200 hover:text-sky-400 transition-colors cursor-pointer"
          title="Reset Sector View (Z7)"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const MultiSensorMap: React.FC<MultiSensorMapProps> = ({
  apiKey,
  bundle,
  nowcast,
  layers,
  onUpdateLayers,
  activeRadarFrameIndex,
  selectedNowcastMinute,
  onSelectNowcastMinute,
  selectedCellId,
  onSelectCell,
  selectedStationId,
  onSelectStation,
  onMapCoordinateClick,
}) => {
  const [hoveredStrikeId, setHoveredStrikeId] = useState<string | null>(null);
  const [hoveredIsochroneKey, setHoveredIsochroneKey] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(7);

  // Interactive AI Track Cone Options
  const [showEnsembleFan, setShowEnsembleFan] = useState<boolean>(true);
  const [showBunkersSplit, setShowBunkersSplit] = useState<boolean>(false);
  const [showAllIsochrones, setShowAllIsochrones] = useState<boolean>(true);
  const [isAnimatingCone, setIsAnimatingCone] = useState<boolean>(false);
  const [focusCellTrigger, setFocusCellTrigger] = useState<number>(0);

  // Interactive GOES-R GLM Gridded Flash Heatmap Options
  const [glmProductMode, setGlmProductMode] = useState<GlmProductMode>('FED');
  const [glmPolarityFilter, setGlmPolarityFilter] = useState<GlmPolarityFilter>('ALL');
  const [glmTimeWindowMin, setGlmTimeWindowMin] = useState<number>(30);
  const [glmOpacity, setGlmOpacity] = useState<number>(0.88);
  const [glmRadiusScale, setGlmRadiusScale] = useState<number>(1.0);
  const [showGlmContours, setShowGlmContours] = useState<boolean>(true);
  const [includeAdvectedGlm, setIncludeAdvectedGlm] = useState<boolean>(true);
  const [focusGlmPeakTrigger, setFocusGlmPeakTrigger] = useState<number>(0);

  // Ref-based pub/sub for Cursor Probe so mousemove NEVER re-renders MultiSensorMap
  const probeListenersRef = useRef<Set<(probe: GlmCursorProbeTelemetry | null) => void>>(
    new Set()
  );
  const handleEmitCursorProbe = React.useCallback(
    (probe: GlmCursorProbeTelemetry | null) => {
      probeListenersRef.current.forEach((cb) => cb(probe));
    },
    []
  );
  const handleSubscribeProbe = React.useCallback(
    (cb: (probe: GlmCursorProbeTelemetry | null) => void) => {
      probeListenersRef.current.add(cb);
      return () => {
        probeListenersRef.current.delete(cb);
      };
    },
    []
  );

  const glmConfig: GlmHeatmapConfig = React.useMemo(
    () => ({
      productMode: glmProductMode,
      polarityFilter: glmPolarityFilter,
      timeWindowMin: glmTimeWindowMin,
      opacity: glmOpacity,
      radiusScale: glmRadiusScale,
      showContours: showGlmContours,
      includeAdvected: includeAdvectedGlm,
    }),
    [
      glmProductMode,
      glmPolarityFilter,
      glmTimeWindowMin,
      glmOpacity,
      glmRadiusScale,
      showGlmContours,
      includeAdvectedGlm,
    ]
  );

  // Auto-advance cone lead-time animation (+15m -> +30m -> +45m -> +60m -> +90m -> +120m)
  useEffect(() => {
    if (!isAnimatingCone || !onSelectNowcastMinute) return;
    const steps = [15, 30, 45, 60, 90, 120];
    const timer = setInterval(() => {
      const idx = steps.indexOf(selectedNowcastMinute);
      const next = steps[(idx + 1) % steps.length];
      onSelectNowcastMinute(next);
    }, 1100);
    return () => clearInterval(timer);
  }, [isAnimatingCone, selectedNowcastMinute, onSelectNowcastMinute]);

  const defaultCenter = {
    lat: bundle?.location.lat ?? 35.4676,
    lng: bundle?.location.lon ?? -97.5164,
  };

  const activeCell =
    bundle?.convectiveCells.find((c) => c.id === selectedCellId) ||
    bundle?.convectiveCells[0] ||
    null;

  // Filtered strikes matching active GLM polarity and temporal window
  const filteredStrikes = React.useMemo(() => {
    if (!bundle) return [];
    return bundle.lightningStrikes.filter((ltg) => {
      if (ltg.ageMinutes > glmTimeWindowMin) return false;
      if (glmPolarityFilter !== 'ALL' && ltg.polarity !== glmPolarityFilter) return false;
      return true;
    });
  }, [bundle, glmPolarityFilter, glmTimeWindowMin]);

  const activeBaseMapMode: BaseMapMode = layers.baseMapMode || 'DARK_TACTICAL';

  return (
    <div className="relative w-full h-full bg-[#080C14]">
      <APIProvider apiKey={apiKey} libraries={['marker']}>
        <Map
          defaultCenter={defaultCenter}
          defaultZoom={7}
          minZoom={2}
          maxZoom={18}
          isFractionalZoomEnabled={false}
          mapId="DEMO_MAP_ID"
          colorScheme="DARK"
          disableDefaultUI={true}
          gestureHandling="greedy"
          className="w-full h-full"
          onClick={(e) => {
            if (e.detail?.latLng) {
              onMapCoordinateClick(e.detail.latLng.lat, e.detail.latLng.lng);
            }
          }}
        >
          <MapOverlaysController
            bundle={bundle}
            nowcast={nowcast}
            layers={layers}
            glmConfig={glmConfig}
            activeRadarFrameIndex={activeRadarFrameIndex}
            selectedNowcastMinute={selectedNowcastMinute}
            selectedCellId={selectedCellId}
            onSelectCell={onSelectCell}
            onSelectNowcastMinute={onSelectNowcastMinute}
            showEnsembleFan={showEnsembleFan}
            showBunkersSplit={showBunkersSplit}
            focusCellTrigger={focusCellTrigger}
            focusGlmPeakTrigger={focusGlmPeakTrigger}
            onZoomChanged={setCurrentZoom}
            onEmitCursorProbe={handleEmitCursorProbe}
          />
          <MapZoomControls
            currentZoom={currentZoom}
            bundle={bundle}
            baseMapMode={activeBaseMapMode}
            solarTerminatorEnabled={layers.solarTerminator !== false}
            onSelectBaseMapMode={
              onUpdateLayers
                ? (mode) =>
                    onUpdateLayers((prev) => ({
                      ...prev,
                      baseMapMode: mode,
                    }))
                : undefined
            }
            onToggleSolarTerminator={
              onUpdateLayers
                ? () =>
                    onUpdateLayers((prev) => ({
                      ...prev,
                      solarTerminator: prev.solarTerminator === false ? true : false,
                    }))
                : undefined
            }
          />

          {/* 1. Target Sector Center Reticle */}
          {bundle && (
            <AdvancedMarker
              position={{ lat: bundle.location.lat, lng: bundle.location.lon }}
              zIndex={15}
            >
              <div className="relative flex items-center justify-center pointer-events-none">
                <div className="w-8 h-8 rounded-full border border-sky-400/50 bg-sky-500/10 flex items-center justify-center">
                  <Crosshair className="w-4 h-4 text-sky-400" />
                </div>
              </div>
            </AdvancedMarker>
          )}

          {/* 2. Doppler Weather Radar Station Markers */}
          {bundle &&
            layers.radarBeams &&
            bundle.radarStations.map((st) => {
              const isSelected = selectedStationId === st.id;
              return (
                <AdvancedMarker
                  key={st.id}
                  position={{ lat: st.lat, lng: st.lon }}
                  zIndex={25}
                  onClick={() => onSelectStation(st)}
                >
                  <div
                    className={`group flex items-center gap-1.5 px-2 py-1 rounded border backdrop-blur-md transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-sky-950/95 border-sky-400 text-sky-100 shadow-lg shadow-sky-500/20 scale-105'
                        : 'bg-[#0F1622]/90 border-slate-700/80 text-slate-200 hover:border-sky-500/60'
                    }`}
                  >
                    <div className="relative flex items-center justify-center">
                      <Radio className="w-3.5 h-3.5 text-sky-400" />
                      {st.status === 'SCANNING' && (
                        <span className="absolute w-3.5 h-3.5 rounded-full bg-sky-400/40 animate-ping" />
                      )}
                    </div>
                    <div className="flex flex-col leading-none">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] font-bold tracking-tight">
                          {st.id}
                        </span>
                        <span className="font-mono text-[9px] text-sky-400">
                          {st.maxDbz}dBZ
                        </span>
                      </div>
                      <span className="font-mono text-[8px] text-slate-400">
                        {(st.band || 'S-Band').split(' ')[0]} · {st.beamHeightKm}km alt
                      </span>
                    </div>
                  </div>
                </AdvancedMarker>
              );
            })}

          {/* 3. GLM / VLF Lightning Strike Markers (Filtered by Polarity & Temporal Window) */}
          {bundle &&
            layers.lightning &&
            filteredStrikes.map((ltg) => {
              const isCgPlus = ltg.polarity === 'CG+';
              const isCgMinus = ltg.polarity === 'CG-';
              const colorClass = isCgPlus
                ? 'text-rose-400 bg-rose-500/20 border-rose-500/60'
                : isCgMinus
                ? 'text-amber-300 bg-amber-500/20 border-amber-400/60'
                : 'text-sky-300 bg-sky-500/20 border-sky-400/50';

              return (
                <AdvancedMarker
                  key={ltg.id}
                  position={{ lat: ltg.lat, lng: ltg.lon }}
                  zIndex={isCgPlus ? 35 : 20}
                  onMouseEnter={() => setHoveredStrikeId(ltg.id)}
                  onMouseLeave={() => setHoveredStrikeId(null)}
                >
                  <div className="relative flex items-center justify-center">
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition-transform hover:scale-125 ${colorClass}`}
                    >
                      <Zap className="w-2.5 h-2.5 fill-current" />
                    </div>
                    {hoveredStrikeId === ltg.id && (
                      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap bg-[#080C14]/95 border border-slate-700 px-2 py-1 rounded text-[9.5px] font-mono text-slate-200 shadow-xl">
                        <span className="font-bold text-amber-400">{ltg.polarity}</span> ·{' '}
                        {ltg.peakCurrentKa} kA · Mult {ltg.multiplicity}x · {ltg.ageMinutes}m ago
                      </div>
                    )}
                  </div>
                </AdvancedMarker>
              );
            })}

          {/* 4. Tracked Convective Cell Markers, Pulsing Target Footprint & Interactive Isochrone Nodes */}
          {bundle &&
            bundle.convectiveCells.map((cell, cellIdx) => {
              const isSelected =
                cell.id === (selectedCellId || bundle.convectiveCells[0]?.id);
              const isSevere =
                cell.severity === 'TORNADIC_SUPERCELL' || cell.severity === 'SEVERE';
              const nowPt =
                cellIdx === 0 && nowcast
                  ? nowcast.timelineProjections.find((p) => p.minuteOffset === 0)
                  : null;
              const liveCellDbz = nowPt ? nowPt.expectedDbz : cell.maxDbz;
              const liveCellFlash = nowPt ? nowPt.expectedFlashRate : cell.flashRatePerMin;

              return (
                <React.Fragment key={cell.id}>
                  <AdvancedMarker
                    position={{ lat: cell.lat, lng: cell.lon }}
                    zIndex={isSelected ? 48 : 38}
                    onClick={() => onSelectCell(cell)}
                  >
                    <div
                      className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-md border backdrop-blur-md cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-rose-950/95 border-rose-400 text-white shadow-lg shadow-rose-500/30 scale-105'
                          : isSevere
                          ? 'bg-[#0F1622]/95 border-rose-500/80 text-slate-100 hover:border-rose-400'
                          : 'bg-[#0F1622]/95 border-amber-500/80 text-slate-100 hover:border-amber-400'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isSevere ? 'bg-rose-500 animate-ping' : 'bg-amber-400'
                        }`}
                      />
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold">
                            {cell.id}
                          </span>
                          <span
                            className={`font-mono text-[10px] font-bold ${
                              isSevere ? 'text-rose-400' : 'text-amber-300'
                            }`}
                          >
                            {liveCellDbz} dBZ
                          </span>
                        </div>
                        <span className="font-mono text-[8.5px] text-slate-300">
                          {liveCellFlash} fl/m · Tb {cell.cloudTopTempC}°C
                        </span>
                      </div>
                      <Navigation
                        className="w-3 h-3 text-sky-400 ml-0.5"
                        style={{ transform: `rotate(${cell.headingDeg}deg)` }}
                      />
                    </div>
                  </AdvancedMarker>

                  {/* Interactive Isochrone Waypoint Badges & Pulsing Target Reticle along the AI Track Cone */}
                  {layers.nowcastCones &&
                    cell.trackForecast
                      .filter(
                        (tf) =>
                          showAllIsochrones ||
                          tf.minOffset === 30 ||
                          tf.minOffset === 60 ||
                          tf.minOffset === 120 ||
                          tf.minOffset === selectedNowcastMinute
                      )
                      .map((tf) => {
                        const isHighlighted =
                          tf.minOffset === selectedNowcastMinute && isSelected;
                        const isochroneKey = `${cell.id}-${tf.minOffset}`;
                        const isHovered = hoveredIsochroneKey === isochroneKey;
                        const distKm = Math.round((cell.speedKmh * tf.minOffset) / 60);
                        const swathWidthKm = Number((tf.radiusKm * 1.7).toFixed(1));
                        const etaStr = formatEtaUtc(tf.minOffset);

                        // Synchronize lead cell projections with active AI/Perturbed Nowcast timeline
                        const syncedNowcastStep =
                          cellIdx === 0 && nowcast
                            ? nowcast.timelineProjections.find(
                                (p) => p.minuteOffset === tf.minOffset
                              )
                            : null;
                        const stepDbz = syncedNowcastStep
                          ? syncedNowcastStep.expectedDbz
                          : tf.projectedDbz;
                        const stepFlash = syncedNowcastStep
                          ? syncedNowcastStep.expectedFlashRate
                          : tf.projectedFlashRate;

                        return (
                          <AdvancedMarker
                            key={isochroneKey}
                            position={{ lat: tf.lat, lng: tf.lon }}
                            zIndex={isHighlighted ? 52 : isHovered ? 50 : isSelected ? 34 : 22}
                            onClick={() => {
                              onSelectCell(cell);
                              onSelectNowcastMinute?.(tf.minOffset);
                            }}
                            onMouseEnter={() => setHoveredIsochroneKey(isochroneKey)}
                            onMouseLeave={() => setHoveredIsochroneKey(null)}
                          >
                            <div className="relative flex flex-col items-center cursor-pointer group">
                              {/* Animated Pulsing Target Ring on Selected Lead-Time Footprint */}
                              {isHighlighted && (
                                <div className="absolute -inset-3 rounded-full border border-sky-400/70 bg-sky-400/10 animate-ping pointer-events-none" />
                              )}

                              {/* Waypoint Node Pill */}
                              <div
                                className={`px-1.5 py-0.5 rounded font-mono text-[8.5px] border transition-all flex items-center gap-1 shadow-md ${
                                  isHighlighted
                                    ? 'bg-sky-400 text-slate-950 font-bold border-white scale-110 shadow-sky-500/40'
                                    : isSelected
                                    ? 'bg-[#080C14]/92 text-slate-100 border-rose-400/70 hover:border-sky-400 hover:scale-105'
                                    : 'bg-[#080C14]/80 text-slate-300 border-slate-700/80 hover:border-slate-500'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isHighlighted
                                      ? 'bg-slate-950'
                                      : isSevere
                                      ? 'bg-rose-400'
                                      : 'bg-amber-400'
                                  }`}
                                />
                                <span>+{tf.minOffset}m</span>
                                <span className="opacity-75">·</span>
                                <span>{stepDbz}dBZ</span>
                                {isHighlighted && (
                                  <span className="hidden sm:inline text-[8px] px-1 rounded bg-slate-950/20">
                                    {etaStr}
                                  </span>
                                )}
                              </div>

                              {/* Rich Hover / Active Telemetry Popover */}
                              {(isHovered || (isHighlighted && isHovered)) && (
                                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 w-52 bg-[#080C14]/95 backdrop-blur-md border border-sky-400/70 rounded-md p-2 text-[9.5px] font-mono text-slate-200 shadow-2xl pointer-events-none">
                                  <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
                                    <span className="font-bold text-sky-400">
                                      {cell.id} · T+{tf.minOffset}m
                                    </span>
                                    <span className="text-emerald-300">{etaStr}</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1 text-[9px]">
                                    <div>
                                      <span className="text-slate-500 block">CORE dBZ</span>
                                      <span className="text-rose-400 font-bold">
                                        {stepDbz} dBZ
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block">FLASH RATE</span>
                                      <span className="text-amber-400 font-bold">
                                        {stepFlash} fl/m
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block">SWATH / DIST</span>
                                      <span className="text-slate-200">
                                        {swathWidthKm}km · {distKm}km
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block">MOTION</span>
                                      <span className="text-sky-300">
                                        {cell.headingDeg}° @ {cell.speedKmh}km/h
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </AdvancedMarker>
                        );
                      })}
                </React.Fragment>
              );
            })}

          {/* 5. 9-Point Mesoscale Open-Meteo NWP Grid Markers */}
          {bundle &&
            layers.nwpGrid &&
            bundle.mesoscaleGrid.map((pt) => (
              <AdvancedMarker
                key={pt.id}
                position={{ lat: pt.lat, lng: pt.lon }}
                zIndex={18}
              >
                <div className="bg-[#080C14]/85 border border-emerald-500/40 rounded px-1.5 py-0.5 text-[8.5px] font-mono text-slate-200 flex items-center gap-1 pointer-events-none">
                  <Wind
                    className="w-2.5 h-2.5 text-emerald-400"
                    style={{ transform: `rotate(${pt.windDir10mDeg}deg)` }}
                  />
                  <div>
                    <div className="text-emerald-300 font-semibold">
                      {pt.capeJkg} J/kg
                    </div>
                    <div className="text-slate-400">
                      {pt.temp2mC}°C / {pt.windSpeed10mKt}kt
                    </div>
                  </div>
                </div>
              </AdvancedMarker>
            ))}
        </Map>
      </APIProvider>

      {/* Top-Center Interactive AI Track Cone & GOES-R GLM Flash Density Control HUD */}
      {bundle && (layers.nowcastCones || layers.lightningHeatmap) && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 pointer-events-auto hidden lg:flex flex-col items-center gap-1.5">
          {/* Row 1: AI Track Cone Controls */}
          {layers.nowcastCones && activeCell && (
            <div className="bg-[#0F1622]/92 backdrop-blur-md border border-slate-800/90 rounded-lg px-3 py-1.5 shadow-2xl flex items-center gap-2.5 font-mono text-[10px]">
              {/* Tracked Storm Cell Switcher */}
              <div className="flex items-center gap-1">
                <span className="text-slate-400 uppercase text-[9px] mr-0.5">
                  TRACK CONE:
                </span>
                {bundle.convectiveCells.map((c) => {
                  const isActive = c.id === activeCell.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelectCell(c)}
                      className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-rose-500/25 border-rose-400 text-rose-200 font-bold'
                          : 'bg-[#080C14] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {c.id}
                    </button>
                  );
                })}
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Cone Lead-Time Sweep Play/Pause & Focus Bounds */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsAnimatingCone((p) => !p)}
                  className={`px-2 py-0.5 rounded border flex items-center gap-1 transition-colors cursor-pointer ${
                    isAnimatingCone
                      ? 'bg-sky-500 text-slate-950 border-sky-300 font-bold'
                      : 'bg-[#080C14] hover:bg-slate-800 text-sky-300 border-slate-700'
                  }`}
                  title="Animate Storm Footprint Along 0-120m Track Cone"
                >
                  {isAnimatingCone ? (
                    <Pause className="w-3 h-3 fill-current" />
                  ) : (
                    <Play className="w-3 h-3 fill-current" />
                  )}
                  <span>{isAnimatingCone ? 'SWEEPING' : 'SWEEP CONE'}</span>
                </button>

                <button
                  onClick={() => setFocusCellTrigger((c) => c + 1)}
                  className="px-2 py-0.5 rounded bg-[#080C14] hover:bg-slate-800 border border-slate-700 text-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Frame Active 0-120m Storm Cone in Map Viewport"
                >
                  <Target className="w-3 h-3 text-rose-400" />
                  <span>FOCUS</span>
                </button>
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Cone Geometry Feature Toggles */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowEnsembleFan((p) => !p)}
                  className={`px-2 py-0.5 rounded border flex items-center gap-1 transition-colors cursor-pointer ${
                    showEnsembleFan
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                      : 'bg-[#080C14] border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                  title="Toggle 90% Ensemble Spread Uncertainty Fan (2σ)"
                >
                  <Layers className="w-3 h-3" />
                  <span>90% FAN</span>
                </button>

                <button
                  onClick={() => setShowBunkersSplit((p) => !p)}
                  className={`px-2 py-0.5 rounded border flex items-center gap-1 transition-colors cursor-pointer ${
                    showBunkersSplit
                      ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                      : 'bg-[#080C14] border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                  title="Toggle Bunkers Right-Mover (+16°) & Left-Mover (-16°) Supercell Split Vectors"
                >
                  <GitBranch className="w-3 h-3" />
                  <span>BUNKERS SPLIT</span>
                </button>

                <button
                  onClick={() => setShowAllIsochrones((p) => !p)}
                  className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                    showAllIsochrones
                      ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                      : 'bg-[#080C14] border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                  title="Show All 15-Minute Isochrone Waypoint Nodes"
                >
                  <span>ALL ISOCHRONES</span>
                </button>

                {onUpdateLayers && (
                  <button
                    onClick={() =>
                      onUpdateLayers((prev) => ({
                        ...prev,
                        lightningHeatmap: !prev.lightningHeatmap,
                      }))
                    }
                    className={`px-2 py-0.5 rounded border flex items-center gap-1 transition-colors cursor-pointer ${
                      layers.lightningHeatmap
                        ? 'bg-orange-500/20 border-orange-400/70 text-orange-200'
                        : 'bg-[#080C14] border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                    title="Toggle GOES-R GLM Lightning Flash Extent Density (FED) Heatmap"
                  >
                    <Flame className="w-3 h-3 text-orange-400" />
                    <span>GLM HEATMAP</span>
                  </button>
                )}
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Active Isochrone Telemetry Summary */}
              {(() => {
                const tf =
                  activeCell.trackForecast.find(
                    (t) => t.minOffset === selectedNowcastMinute
                  ) || activeCell.trackForecast[0];
                if (!tf) return null;
                const isLead = activeCell.id === bundle.convectiveCells[0]?.id;
                const syncedNowcastStep =
                  isLead && nowcast
                    ? nowcast.timelineProjections.find(
                        (p) => p.minuteOffset === tf.minOffset
                      )
                    : null;
                const dispDbz = syncedNowcastStep
                  ? syncedNowcastStep.expectedDbz
                  : tf.projectedDbz;
                const dispFlash = syncedNowcastStep
                  ? syncedNowcastStep.expectedFlashRate
                  : tf.projectedFlashRate;
                const distKm = Math.round((activeCell.speedKmh * tf.minOffset) / 60);
                return (
                  <div className="flex items-center gap-2 text-[9.5px]">
                    <span className="text-sky-400 font-bold">
                      T+{tf.minOffset}m ({formatEtaUtc(tf.minOffset)})
                    </span>
                    <span className="text-slate-300">
                      {distKm}km @ {activeCell.headingDeg}°
                    </span>
                    <span className="text-rose-400 font-bold">
                      {dispDbz}dBZ
                    </span>
                    <span className="text-amber-300 font-bold">
                      {dispFlash}fl/m
                    </span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Row 2: Dedicated GOES-R GLM Gridded Flash Density & Spatial Probe Workstation Bar */}
          {layers.lightningHeatmap && (
            <div className="bg-[#0F1622]/94 backdrop-blur-md border border-orange-500/40 rounded-lg px-3 py-1.5 shadow-2xl flex items-center gap-2.5 font-mono text-[10px]">
              {/* GLM Gridded Product Selector (FED / TOE / MFA / LJA) */}
              <div className="flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="text-orange-300 font-bold text-[9px] mr-0.5">
                  GLM PRODUCT:
                </span>
                {(
                  [
                    { id: 'FED', label: 'FED (fl/m)', tip: 'Flash Extent Density (flashes/min)' },
                    { id: 'TOE', label: 'TOE (fJ)', tip: 'Total Optical Energy (femtojoules / kA)' },
                    { id: 'MFA', label: 'MFA (km²)', tip: 'Minimum Flash Area (Updraft Charging Core)' },
                    { id: 'LJA', label: '2σ JUMP', tip: '2-Sigma Lightning Jump Anomaly (df/dt)' },
                  ] as const
                ).map((prod) => (
                  <button
                    key={prod.id}
                    onClick={() => setGlmProductMode(prod.id)}
                    title={prod.tip}
                    className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                      glmProductMode === prod.id
                        ? 'bg-orange-500/25 border-orange-400 text-orange-200 font-bold'
                        : 'bg-[#080C14] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {prod.label}
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Polarity Filter (ALL / CG+ / CG- / IC) */}
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[9px]">POLARITY:</span>
                {(['ALL', 'CG+', 'CG-', 'IC'] as const).map((pol) => (
                  <button
                    key={pol}
                    onClick={() => setGlmPolarityFilter(pol)}
                    className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                      glmPolarityFilter === pol
                        ? pol === 'CG+'
                          ? 'bg-rose-500/25 border-rose-400 text-rose-200 font-bold'
                          : pol === 'CG-'
                          ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold'
                          : 'bg-sky-500/25 border-sky-400 text-sky-200 font-bold'
                        : 'bg-[#080C14] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {pol}
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Temporal Accumulation Window (5m / 15m / 30m) */}
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[9px]">WINDOW:</span>
                {[5, 15, 30].map((win) => (
                  <button
                    key={win}
                    onClick={() => setGlmTimeWindowMin(win)}
                    className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                      glmTimeWindowMin === win
                        ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold'
                        : 'bg-[#080C14] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {win}m
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Iso-Contours, Advected Forecast Core & Peak Core Lock */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowGlmContours((p) => !p)}
                  className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                    showGlmContours
                      ? 'bg-sky-500/20 border-sky-400/70 text-sky-200'
                      : 'bg-[#080C14] border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                  title="Toggle Iso-FED Electrification Contours (5 fl/m Anvil & 20+ fl/m Jump Core)"
                >
                  CONTOURS
                </button>

                <button
                  onClick={() => setIncludeAdvectedGlm((p) => !p)}
                  className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                    includeAdvectedGlm
                      ? 'bg-emerald-500/20 border-emerald-400/70 text-emerald-200'
                      : 'bg-[#080C14] border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                  title="Couple Heatmap with Advected T+Lead-Time Forecast Flash Core"
                >
                  +ADVECT T+{selectedNowcastMinute}m
                </button>

                <button
                  onClick={() =>
                    setGlmRadiusScale((s) => (s === 1.0 ? 1.35 : s === 1.35 ? 0.75 : 1.0))
                  }
                  className="px-1.5 py-0.5 rounded bg-[#080C14] hover:bg-slate-800 border border-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="Cycle Gaussian Kernel Smoothing Bandwidth (0.75x Crisp / 1.0x Std / 1.35x Wide)"
                >
                  KERNEL {glmRadiusScale}x
                </button>

                <button
                  onClick={() => setFocusGlmPeakTrigger((c) => c + 1)}
                  className="px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/70 text-rose-200 font-bold flex items-center gap-1 transition-colors cursor-pointer"
                  title="Center & Zoom onto Peak GLM Lightning Jump Core"
                >
                  <Zap className="w-3 h-3 text-amber-300 fill-current" />
                  <span>PEAK CORE</span>
                </button>
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Real-Time Cursor Spatial Probe Readout (Isolated Sub-Component) */}
              <GlmSpatialProbeReadout subscribeProbe={handleSubscribeProbe} />
            </div>
          )}

          {/* Active NWS Severe Weather Warning Banner (when active in US sector) */}
          {bundle.activeAlerts.length > 0 && (
            <div className="bg-rose-950/90 backdrop-blur-md border border-rose-500/70 rounded-md px-3 py-1 flex items-center gap-2 shadow-xl max-w-xl">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 animate-pulse" />
              <div className="text-[11px] truncate">
                <span className="font-mono font-bold text-rose-300 uppercase mr-1.5">
                  {bundle.activeAlerts[0].event}:
                </span>
                <span className="text-slate-200">{bundle.activeAlerts[0].headline}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom-Left Compact Reflectivity (dBZ), Track Cone & Dynamic GLM Gridded Product Legend */}
      <div className="absolute bottom-20 left-4 z-20 pointer-events-auto bg-[#0F1622]/90 backdrop-blur-md border border-slate-800/90 rounded-md px-3 py-2 shadow-xl hidden md:flex items-center gap-4">
        <div>
          <div className="text-[9.5px] font-mono uppercase tracking-wider text-slate-400 mb-1">
            Radar Reflectivity (dBZ)
          </div>
          <div className="flex items-center gap-0.5">
            {[
              { label: '10', color: 'bg-sky-500' },
              { label: '20', color: 'bg-emerald-500' },
              { label: '30', color: 'bg-green-600' },
              { label: '40', color: 'bg-yellow-400' },
              { label: '50', color: 'bg-orange-500' },
              { label: '60', color: 'bg-rose-600' },
              { label: '65+', color: 'bg-fuchsia-500' },
            ].map((b) => (
              <div key={b.label} className="flex flex-col items-center">
                <span className={`w-5 h-1.5 ${b.color} rounded-xs`} />
                <span className="text-[8.5px] font-mono text-slate-400 mt-0.5">
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        <div className="flex flex-col gap-1 text-[9.5px] font-mono">
          <div className="text-slate-400 uppercase tracking-wider">
            GLM Discharges ({filteredStrikes.length})
          </div>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> CG+ (&gt;35kA)
            </span>
            <span className="flex items-center gap-1 text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> CG-
            </span>
            <span className="flex items-center gap-1 text-sky-300">
              <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> Intra-Cloud (IC)
            </span>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        <div className="flex flex-col gap-1 text-[9.5px] font-mono">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400 uppercase tracking-wider">
              GLM {glmProductMode} Heatmap
            </span>
            <input
              type="range"
              min={0.25}
              max={1}
              step={0.05}
              value={glmOpacity}
              onChange={(e) => setGlmOpacity(Number(e.target.value))}
              className="w-12 accent-orange-400 cursor-pointer"
              title={`GLM Heatmap Opacity: ${Math.round(glmOpacity * 100)}%`}
            />
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-24 h-2 rounded-xs border border-slate-700 ${
                glmProductMode === 'TOE'
                  ? 'bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-yellow-300'
                  : glmProductMode === 'MFA'
                  ? 'bg-gradient-to-r from-teal-500 via-cyan-400 to-indigo-200'
                  : glmProductMode === 'LJA'
                  ? 'bg-gradient-to-r from-amber-500 via-red-500 to-fuchsia-200'
                  : 'bg-gradient-to-r from-sky-500 via-amber-400 to-rose-500'
              }`}
            />
            <span className="text-[8.5px] text-amber-300">
              {glmProductMode === 'TOE'
                ? '10 → 1800+ fJ'
                : glmProductMode === 'MFA'
                ? '180 → 18 km²'
                : glmProductMode === 'LJA'
                ? '0.5σ → 3.5σ+'
                : '1 → 45+ fl/m'}
            </span>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        <div className="flex flex-col gap-1 text-[9.5px] font-mono">
          <div className="text-slate-400 uppercase tracking-wider">AI Track Cone Geometry</div>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1 text-rose-300">
              <span className="w-2.5 h-1.5 rounded-xs bg-rose-500/40 border border-rose-400 inline-block" /> 50% Core Swath
            </span>
            <span className="flex items-center gap-1 text-amber-200">
              <span className="w-2.5 h-1.5 rounded-xs bg-rose-500/15 border border-dashed border-rose-300 inline-block" /> 90% Ensemble
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
