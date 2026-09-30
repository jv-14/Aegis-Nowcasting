export interface RadarFrame {
  time: number;
  path: string;
  isNowcast: boolean;
  label: string;
}

export interface SatelliteFrame {
  time: number;
  path: string;
  label: string;
}

export interface DopplerRadarStation {
  id: string;
  name: string;
  network: string;
  band: 'S-Band (10cm)' | 'C-Band (5cm)' | 'X-Band (3cm)';
  lat: number;
  lon: number;
  elevationM: number;
  distanceKm: number;
  azimuthDeg: number;
  beamHeightKm: number;
  maxDbz: number;
  vilKgM2: number;
  echoTopKm: number;
  zdrDb: number;
  kdpDegKm: number;
  status: 'ONLINE' | 'SCANNING';
}

export interface LightningStrike {
  id: string;
  lat: number;
  lon: number;
  timestamp: number;
  polarity: 'CG-' | 'CG+' | 'IC';
  peakCurrentKa: number;
  multiplicity: number;
  ageMinutes: number;
}

export interface TrackForecastPoint {
  minOffset: number;
  lat: number;
  lon: number;
  radiusKm: number;
  projectedDbz: number;
  projectedFlashRate: number;
}

export interface ConvectiveCell {
  id: string;
  label: string;
  lat: number;
  lon: number;
  maxDbz: number;
  vilKgM2: number;
  echoTopKm: number;
  cloudTopTempC: number;
  coolingRateCPer15m: number;
  flashRatePerMin: number;
  icToCgRatio: number;
  capeJkg: number;
  speedKmh: number;
  headingDeg: number;
  severity: 'SUB_SEVERE' | 'STRONG' | 'SEVERE' | 'TORNADIC_SUPERCELL';
  trackForecast: TrackForecastPoint[];
}

export interface PressureLevelObs {
  pressureHpa: number;
  heightM: number;
  tempC: number;
  dewpointC: number;
  relativeHumidity: number;
  windSpeedKt: number;
  windDirDeg: number;
}

export interface MesoscaleGridPoint {
  id: string;
  lat: number;
  lon: number;
  sectorLabel: string;
  capeJkg: number;
  cinJkg: number;
  liftedIndexC: number;
  temp2mC: number;
  dewpoint2mC: number;
  relHumidity: number;
  precipMmHr: number;
  cloudCoverPct: number;
  cloudCoverHighPct: number;
  weatherCode: number;
  weatherDescription: string;
  windSpeed10mKt: number;
  windDir10mDeg: number;
  windGust10mKt: number;
  cloudTopTempEstC: number;
  simulatedDbz: number;
  isDay?: boolean;
  shortwaveRadiationWm2?: number;
  lightningPotentialJkg?: number;
  surfacePressureHpa?: number;
  visibilityKm?: number;
}

export interface HourlyNwpPoint {
  timeIso: string;
  hourOffset: number;
  capeJkg: number;
  cinJkg: number;
  precipProbPct: number;
  precipMm: number;
  weatherCode: number;
  windGustKt: number;
  liftedIndexC: number;
}

export interface NwpModelTelemetry {
  modelName: string;
  runTimeUtc: string;
  surfaceTempC: number;
  surfaceDewpointC: number;
  surfaceRhPct: number;
  surfacePressureHpa: number;
  capeJkg: number;
  cinJkg: number;
  liftedIndexC: number;
  kIndex: number;
  totalTotals: number;
  lapseRate850To500CPerKm: number;
  bulkShear0To6KmKt: number;
  steeringWindSpeedKt: number;
  steeringWindDirDeg: number;
  freezingLevelM: number;
  precipitableWaterMm: number;
  sounding: PressureLevelObs[];
  hourlyForecast: HourlyNwpPoint[];
}

export interface DiurnalSolarTelemetry {
  isDay: boolean;
  phase: 'DAYLIGHT' | 'CIVIL_TWILIGHT' | 'NAUTICAL_TWILIGHT' | 'NIGHT';
  diurnalPhaseLabel?: string;
  diurnalRegime: string;
  timezone: string;
  timezoneAbbrev: string;
  utcOffsetSeconds: number;
  localTimeFormatted: string;
  sunriseLocal: string;
  sunsetLocal: string;
  daylightDurationHours: number;
  daylightHours?: number;
  solarElevationDeg: number;
  solarAzimuthDeg: number;
  subsolarLat: number;
  subsolarLon: number;
  shortwaveRadiationWm2: number;
  directRadiationWm2: number;
  diffuseRadiationWm2: number;
  uvIndex: number;
  surfaceRadiativeFluxLabel: string;
}

export interface RealtimeSurfaceWeather {
  observedAtUtc: string;
  temp2mC: number;
  feelsLikeC: number;
  apparentTempC?: number;
  dewpoint2mC: number;
  relHumidityPct: number;
  relativeHumidityPct?: number;
  surfacePressureHpa: number;
  pressureMslHpa: number;
  windSpeed10mKt: number;
  windDir10mDeg: number;
  windGust10mKt: number;
  windGusts10mKt?: number;
  precipMmHr: number;
  rainMmHr: number;
  showersMmHr: number;
  snowfallCmHr: number;
  cloudCoverTotalPct: number;
  cloudCoverLowPct: number;
  cloudCoverMidPct: number;
  cloudCoverHighPct: number;
  visibilityKm: number;
  weatherCode: number;
  weatherDescription: string;
  weatherConditionLabel?: string;
  isDay: boolean;
}

export interface NwsAlert {
  id: string;
  event: string;
  headline: string;
  severity: string;
  certainty: string;
  urgency: string;
  areaDesc: string;
  effective: string;
  expires: string;
  description: string;
}

export interface GlobalHotspot {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  capeJkg: number;
  temp2mC: number;
  precipMmHr: number;
  weatherCode: number;
  weatherLabel: string;
  windGustKt: number;
  convectiveStatus: 'ACTIVE_STORM' | 'HIGH_INSTABILITY' | 'MODERATE_CAPE' | 'STABLE';
  isDay?: boolean;
  solarElevationDeg?: number;
  localTimeStr?: string;
  localTimeFormatted?: string;
  estimatedDbz?: number;
  utcOffsetSeconds?: number;
  relHumidityPct?: number;
  windSpeedKt?: number;
  windDirDeg?: number;
  cloudCoverPct?: number;
  surfacePressureHpa?: number;
  shortwaveRadiationWm2?: number;
}

export interface ObservationBundle {
  location: {
    name: string;
    region: string;
    lat: number;
    lon: number;
  };
  fetchedAtUtc: string;
  diurnal?: DiurnalSolarTelemetry;
  realtimeWeather?: RealtimeSurfaceWeather;
  radarTileHost: string;
  radarFrames: RadarFrame[];
  satelliteFrames: SatelliteFrame[];
  radarStations: DopplerRadarStation[];
  convectiveCells: ConvectiveCell[];
  lightningStrikes: LightningStrike[];
  mesoscaleGrid: MesoscaleGridPoint[];
  nwp: NwpModelTelemetry;
  activeAlerts: NwsAlert[];
}

export interface NowcastTimelineProjection {
  minuteOffset: number;
  label: string;
  expectedDbz: number;
  expectedFlashRate: number;
  convectiveProbPct: number;
  primaryHazard: string;
  physicalProcess: string;
}

export interface AiNowcastResult {
  generatedAtUtc: string;
  modelUsed: string;
  alertLevel: 'NORMAL' | 'WATCH' | 'ADVISORY' | 'SEVERE_WARNING' | 'EXTREME_CRITICAL';
  stormMode: string;
  convectiveInitiationProbPct: number;
  lightningJumpProbPct: number;
  projectedPeakFlashRatePerMin: number;
  projectedMaxDbz: number;
  hailThreatProbPct: number;
  microburstWindProbPct: number;
  confidenceScorePct: number;
  headlineSummary: string;
  synopticAndMesoscaleAnalysis: string;
  multiSensorCrossCorrelation: {
    radarSignature: string;
    satelliteIrSignature: string;
    lightningGlmSignature: string;
    nwpThermodynamicState: string;
  };
  sensorAttributionWeights: {
    radar: number;
    satellite: number;
    lightning: number;
    nwpModel: number;
  };
  timelineProjections: NowcastTimelineProjection[];
  operationalDirectives: Array<{
    sector: 'AVIATION' | 'POWER_GRID' | 'PUBLIC_SAFETY' | 'RADAR_OPS';
    priority: 'HIGH' | 'MEDIUM' | 'ROUTINE';
    directive: string;
  }>;
}

export interface PerturbationParams {
  deltaTempC: number;
  deltaDewpointC: number;
  deltaShearKt: number;
}
