import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Radar,
  Globe,
  Search,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  LocateFixed,
  Zap,
  Activity,
  Clock,
  RefreshCw,
  ChevronDown,
  Sun,
  Moon,
} from 'lucide-react';
import type {
  ObservationBundle,
  GlobalHotspot,
  AiNowcastResult,
  PerturbationParams,
  ConvectiveCell,
  DopplerRadarStation,
} from './types/nowcast';
import { MultiSensorMap, type MapLayerState } from './components/MultiSensorMap';
import { MultiSensorObservationDock } from './components/MultiSensorObservationDock';
import { AiNowcastWorkstationDock } from './components/AiNowcastWorkstationDock';

const MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export default function App() {
  const [hotspots, setHotspots] = useState<GlobalHotspot[]>([]);
  const [showHotspotMenu, setShowHotspotMenu] = useState(false);
  const [hotspotFilter, setHotspotFilter] = useState<'ALL' | 'STORMS' | 'DAY' | 'NIGHT'>('ALL');

  const [bundle, setBundle] = useState<ObservationBundle | null>(null);
  const [isLoadingBundle, setIsLoadingBundle] = useState<boolean>(true);

  const [nowcast, setNowcast] = useState<AiNowcastResult | null>(null);
  const [isLoadingNowcast, setIsLoadingNowcast] = useState<boolean>(false);

  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  // Timeline Scrubber State (Radar/Satellite raster frames + AI Nowcast isochrone minute)
  const [activeRadarFrameIndex, setActiveRadarFrameIndex] = useState<number>(0);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState<boolean>(false);
  const [selectedNowcastMinute, setSelectedNowcastMinute] = useState<number>(30);

  // Thermodynamic Perturbation State
  const [perturbation, setPerturbation] = useState<PerturbationParams>({
    deltaTempC: 0,
    deltaDewpointC: 0,
    deltaShearKt: 0,
  });

  // Search Bar State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; name: string; region: string; lat: number; lon: number }>
  >([]);
  const [isSearching, setIsSearching] = useState(false);

  // Live UTC Clock & Real-Time 60-Second Auto-Sync Stream
  const [utcTimeStr, setUtcTimeStr] = useState<string>(() =>
    new Date().toISOString().slice(11, 19)
  );
  const [autoSync, setAutoSync] = useState<boolean>(true);
  const [syncCountdownSec, setSyncCountdownSec] = useState<number>(60);

  useEffect(() => {
    const timer = setInterval(() => {
      setUtcTimeStr(new Date().toISOString().slice(11, 19));
      if (autoSync) {
        setSyncCountdownSec((prev) => (prev <= 1 ? 60 : prev - 1));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [autoSync]);

  // Spatial Map Layer State
  const [layers, setLayers] = useState<MapLayerState>({
    baseMapMode: 'DARK_TACTICAL',
    radar: true,
    radarOpacity: 0.78,
    satellite: false,
    satelliteOpacity: 0.65,
    nexradHiRes: false,
    radarBeams: true,
    lightning: true,
    lightningHeatmap: true,
    nowcastCones: true,
    nwpGrid: false,
    solarTerminator: true,
  });

  const inFlightNowcastKeyRef = useRef<string | null>(null);
  const hasInitializedScannerRef = useRef<boolean>(false);

  // Execute Gemini AI Nowcast Fusion
  const runAiNowcast = useCallback(
    async (
      targetBundle: ObservationBundle,
      customPerturbation?: PerturbationParams
    ) => {
      const p = customPerturbation ?? {
        deltaTempC: 0,
        deltaDewpointC: 0,
        deltaShearKt: 0,
      };
      const reqKey = `${targetBundle.location.lat.toFixed(2)}:${targetBundle.location.lon.toFixed(2)}:${p.deltaTempC}:${p.deltaDewpointC}:${p.deltaShearKt}`;
      if (inFlightNowcastKeyRef.current === reqKey) {
        return;
      }
      inFlightNowcastKeyRef.current = reqKey;
      setIsLoadingNowcast(true);
      try {
        const res = await fetch('/api/ai-nowcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundle: targetBundle,
            perturbation: p,
          }),
        });
        if (res.ok) {
          const data: AiNowcastResult = await res.json();
          setNowcast(data);
        }
      } catch {
        // Fallback handled by server
      } finally {
        if (inFlightNowcastKeyRef.current === reqKey) {
          inFlightNowcastKeyRef.current = null;
        }
        setIsLoadingNowcast(false);
      }
    },
    []
  );

  // Fetch Multi-Sensor Observation Bundle for a Target Coordinate
  const loadSectorObservation = useCallback(
    async (lat: number, lon: number, name?: string, region?: string) => {
      setIsLoadingBundle(true);
      try {
        const params = new URLSearchParams({
          lat: String(lat),
          lon: String(lon),
        });
        if (name) params.set('name', name);
        if (region) params.set('region', region);

        const res = await fetch(`/api/observation-bundle?${params.toString()}`);
        if (!res.ok) throw new Error('Observation fetch failed');
        const data: ObservationBundle = await res.json();

        setBundle(data);
        setSelectedCellId(data.convectiveCells[0]?.id ?? null);
        setSelectedStationId(data.radarStations[0]?.id ?? null);

        // Set radar frame to latest live observation frame
        const latestLiveIdx = data.radarFrames.reduce(
          (acc, f, idx) => (!f.isNowcast ? idx : acc),
          Math.max(0, data.radarFrames.length - 1)
        );
        setActiveRadarFrameIndex(latestLiveIdx);

        // Reset perturbations for new sector and run Gemini AI Nowcast
        const freshPerturb = { deltaTempC: 0, deltaDewpointC: 0, deltaShearKt: 0 };
        setPerturbation(freshPerturb);
        void runAiNowcast(data, freshPerturb);
      } catch (err) {
        console.warn('Observation bundle retry or fallback:', err);
      } finally {
        setIsLoadingBundle(false);
      }
    },
    [runAiNowcast]
  );

  // Initial Global Convective Hotspot Scan & Auto-Selection of Top Live Storm Sector
  useEffect(() => {
    if (hasInitializedScannerRef.current) return;
    hasInitializedScannerRef.current = true;

    let mounted = true;
    async function initScanner() {
      try {
        const res = await fetch('/api/global-hotspots');
        if (res.ok) {
          const data = await res.json();
          const list: GlobalHotspot[] = data.hotspots || [];
          if (mounted && list.length > 0) {
            setHotspots(list);
            const top = list[0];
            void loadSectorObservation(top.lat, top.lon, top.name, top.region);
            return;
          }
        }
      } catch {
        // Fallback to default sector below
      }
      if (mounted) {
        void loadSectorObservation(
          35.4676,
          -97.5164,
          'Oklahoma City / Southern Plains',
          'NEXRAD Tornado Alley, USA'
        );
      }
    }
    void initScanner();
    return () => {
      mounted = false;
    };
  }, [loadSectorObservation]);

  // Real-Time 60-Second Continuous Telemetry Auto-Refresh (Sector + Global Hotspots)
  useEffect(() => {
    if (!autoSync || syncCountdownSec !== 1 || !bundle) return;
    void loadSectorObservation(
      bundle.location.lat,
      bundle.location.lon,
      bundle.location.name,
      bundle.location.region
    );
    fetch('/api/global-hotspots')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.hotspots?.length) setHotspots(d.hotspots);
      })
      .catch(() => {});
  }, [autoSync, syncCountdownSec, bundle, loadSectorObservation]);

  // Radar & Satellite Timeline Playback Loop
  useEffect(() => {
    if (!isPlayingTimeline || !bundle || bundle.radarFrames.length === 0) return;
    const interval = setInterval(() => {
      setActiveRadarFrameIndex((prev) => (prev + 1) % bundle.radarFrames.length);
    }, 850);
    return () => clearInterval(interval);
  }, [isPlayingTimeline, bundle]);

  // Handle Place Geocoding Search
  const handleSearchLocations = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchQuery.trim())}`
      );
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle User Geolocation
  const handleLocateUser = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void loadSectorObservation(
          Number(pos.coords.latitude.toFixed(4)),
          Number(pos.coords.longitude.toFixed(4)),
          'Local Atmospheric Sector',
          'GPS Telemetry Domain'
        );
      },
      (err) => {
        console.warn('Geolocation unavailable:', err.message);
      }
    );
  };

  const currentRadarFrame = bundle?.radarFrames[activeRadarFrameIndex];
  const leadCell = bundle?.convectiveCells[0];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#080C14] select-none">
      {/* FULL-VIEWPORT GOOGLE MAPS MULTI-SENSOR CANVAS */}
      <MultiSensorMap
        apiKey={MAPS_API_KEY}
        bundle={bundle}
        nowcast={nowcast}
        layers={layers}
        onUpdateLayers={setLayers}
        activeRadarFrameIndex={activeRadarFrameIndex}
        selectedNowcastMinute={selectedNowcastMinute}
        onSelectNowcastMinute={setSelectedNowcastMinute}
        selectedCellId={selectedCellId}
        onSelectCell={(cell: ConvectiveCell) => setSelectedCellId(cell.id)}
        selectedStationId={selectedStationId}
        onSelectStation={(st: DopplerRadarStation) => setSelectedStationId(st.id)}
        onMapCoordinateClick={(lat, lon) => {
          void loadSectorObservation(
            Number(lat.toFixed(4)),
            Number(lon.toFixed(4)),
            `Mesoscale Probe ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
            'Custom Map Telemetry Sector'
          );
        }}
      />

      {/* TOP TELEMETRY & COMMAND BAR */}
      <header className="absolute top-0 left-0 right-0 h-13 bg-[#080C14]/90 backdrop-blur-md border-b border-slate-800/90 z-30 px-4 flex items-center justify-between gap-3">
        {/* Brand & System Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-sky-500/15 border border-sky-400/50 flex items-center justify-center">
              <Radar className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-bold tracking-wider text-slate-100">
                  AEGIS // AIML NOWCAST
                </span>
                <span className="text-[9.5px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  LIVE TELEMETRY
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400 hidden sm:block">
                Multi-Radar · GOES-IR · GLM Lightning · Open-Meteo NWP
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden lg:block" />

          {/* Global Convective Sector Selector */}
          <div className="relative">
            <button
              onClick={() => setShowHotspotMenu((prev) => !prev)}
              className="bg-[#0F1622] hover:bg-slate-800/90 border border-slate-700/80 rounded-md px-2.5 py-1.5 flex items-center gap-2 text-xs transition-colors cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <div className="text-left leading-tight max-w-[200px] truncate">
                <span className="font-medium text-slate-100 block truncate">
                  {bundle?.location.name || 'Scanning Global Sectors...'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {showHotspotMenu && (
              <div className="absolute top-11 left-0 w-96 bg-[#0F1622]/98 backdrop-blur-xl border border-slate-700 rounded-lg shadow-2xl p-2 z-50 space-y-1.5">
                <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between border-b border-slate-800">
                  <span>Live Global Convective Scanner ({hotspots.length})</span>
                  <span className="text-sky-400">REAL-TIME OPEN-METEO</span>
                </div>

                {/* Filter Tabs: ALL / STORMS / DAY / NIGHT */}
                <div className="grid grid-cols-4 gap-1 px-1 font-mono text-[9.5px]">
                  {(
                    [
                      { id: 'ALL', label: 'ALL SECTORS' },
                      { id: 'STORMS', label: 'STORMS' },
                      { id: 'DAY', label: 'DAYLIGHT' },
                      { id: 'NIGHT', label: 'NIGHTTIME' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setHotspotFilter(tab.id)}
                      className={`py-1 rounded border text-center transition-colors cursor-pointer ${
                        hotspotFilter === tab.id
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-bold'
                          : 'bg-[#080C14] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1 pt-0.5">
                  {hotspots
                    .filter((h) => {
                      if (hotspotFilter === 'STORMS') {
                        return (
                          h.convectiveStatus === 'ACTIVE_STORM' ||
                          h.convectiveStatus === 'HIGH_INSTABILITY' ||
                          (h.estimatedDbz ?? 0) >= 25
                        );
                      }
                      if (hotspotFilter === 'DAY') return h.isDay !== false;
                      if (hotspotFilter === 'NIGHT') return h.isDay === false;
                      return true;
                    })
                    .map((h) => {
                      const badgeColor =
                        h.convectiveStatus === 'ACTIVE_STORM'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : h.convectiveStatus === 'HIGH_INSTABILITY'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : h.convectiveStatus === 'MODERATE_CAPE'
                          ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700';

                      return (
                        <button
                          key={h.id}
                          onClick={() => {
                            setShowHotspotMenu(false);
                            void loadSectorObservation(h.lat, h.lon, h.name, h.region);
                          }}
                          className="w-full p-2 rounded hover:bg-slate-800/80 text-left flex items-center justify-between transition-colors cursor-pointer border border-transparent hover:border-slate-700/80"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              {h.isDay !== false ? (
                                <Sun className="w-3 h-3 text-amber-400 shrink-0" />
                              ) : (
                                <Moon className="w-3 h-3 text-indigo-400 shrink-0" />
                              )}
                              <span className="text-xs font-medium text-slate-100 truncate">
                                {h.name}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                              {h.localTimeFormatted || h.localTimeStr
                                ? `${h.localTimeFormatted || h.localTimeStr} · `
                                : ''}
                              {h.weatherLabel} · {h.temp2mC}°C · Gust {h.windGustKt}kt
                            </div>
                          </div>
                          <div className="text-right shrink-0 font-mono">
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded border block mb-0.5 ${badgeColor}`}
                            >
                              {h.convectiveStatus.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] text-amber-300 font-bold">
                              {h.capeJkg} J/kg · {h.estimatedDbz ?? 0}dBZ
                            </span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* City / Airport Search Input */}
          <div className="relative hidden md:block">
            <form onSubmit={handleSearchLocations} className="flex items-center">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value.trim()) setSearchResults([]);
                  }}
                  placeholder="Jump to city or airport..."
                  className="bg-[#0F1622] border border-slate-700/80 rounded-md pl-8 pr-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 w-48 focus:outline-none focus:border-sky-400"
                />
              </div>
              <button
                type="button"
                onClick={handleLocateUser}
                className="ml-1.5 p-1.5 rounded-md bg-[#0F1622] hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-sky-400 transition-colors cursor-pointer"
                title="Probe My GPS Coordinates"
              >
                <LocateFixed className="w-3.5 h-3.5" />
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="absolute top-10 left-0 w-64 bg-[#0F1622] border border-slate-700 rounded-md shadow-2xl p-1 z-50">
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setSearchResults([]);
                      setSearchQuery('');
                      void loadSectorObservation(r.lat, r.lon, r.name, r.region);
                    }}
                    className="w-full px-2.5 py-1.5 text-left rounded hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-medium text-slate-100">
                      {r.name}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      {r.region} ({r.lat.toFixed(2)}°, {r.lon.toFixed(2)}°)
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Telemetry Strip */}
        <div className="flex items-center gap-3 font-mono text-xs">
          {bundle && (
            <div className="hidden xl:flex items-center gap-3.5">
              {/* Real-Time Sector Day/Night & Solar Telemetry */}
              {bundle.diurnal && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0F1622] border border-slate-800">
                  {bundle.diurnal.isDay ? (
                    <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Moon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  )}
                  <div>
                    <span
                      className={`text-[9px] font-bold block ${
                        bundle.diurnal.isDay ? 'text-amber-300' : 'text-indigo-300'
                      }`}
                    >
                      {bundle.diurnal.isDay ? 'REAL-TIME DAY' : 'REAL-TIME NIGHT'} (
                      {bundle.diurnal.solarElevationDeg > 0 ? '+' : ''}
                      {bundle.diurnal.solarElevationDeg}°)
                    </span>
                    <span className="text-[10px] text-slate-200 font-semibold">
                      {bundle.diurnal.localTimeFormatted}
                    </span>
                  </div>
                </div>
              )}

              {/* Real-Time Surface Weather */}
              {bundle.realtimeWeather && (
                <div>
                  <span className="text-[9px] text-slate-500 block">LIVE WEATHER</span>
                  <span className="text-sky-300 font-bold">
                    {bundle.realtimeWeather.temp2mC}°C ·{' '}
                    {
                      (
                        bundle.realtimeWeather.weatherDescription ||
                        bundle.realtimeWeather.weatherConditionLabel ||
                        'Clear'
                      ).split(' ')[0]
                    }
                  </span>
                </div>
              )}

              <div>
                <span className="text-[9px] text-slate-500 block">SECTOR CAPE</span>
                <span className="text-amber-400 font-bold">
                  {bundle.nwp.capeJkg} J/kg
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-500 block">PEAK RADAR Z</span>
                <span className="text-rose-400 font-bold">
                  {leadCell?.maxDbz ?? 0} dBZ
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-500 block">GLM FLASH/M</span>
                <span className="text-sky-300 font-bold">
                  {leadCell?.flashRatePerMin ?? 0} fl/m
                </span>
              </div>
            </div>
          )}

          {/* Auto-Sync 60s Live Stream Indicator */}
          <button
            onClick={() => setAutoSync((prev) => !prev)}
            className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] transition-colors cursor-pointer ${
              autoSync
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-[#0F1622] border-slate-800 text-slate-400'
            }`}
            title="Toggle 60-Second Continuous Real-Time Atmospheric & Solar Auto-Sync"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                autoSync ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span>{autoSync ? `SYNC ${syncCountdownSec}s` : 'SYNC PAUSED'}</span>
          </button>

          <div className="flex items-center gap-1.5 bg-[#0F1622] border border-slate-800 px-2.5 py-1 rounded text-[11px]">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-slate-200 font-semibold">{utcTimeStr}</span>
            <span className="text-slate-500">UTC</span>
          </div>

          <button
            onClick={() => {
              if (bundle) {
                setSyncCountdownSec(60);
                void loadSectorObservation(
                  bundle.location.lat,
                  bundle.location.lon,
                  bundle.location.name,
                  bundle.location.region
                );
              }
            }}
            disabled={isLoadingBundle || isSearching}
            className="p-1.5 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer transition-colors"
            title="Refresh All Live Sensors Now"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoadingBundle ? 'animate-spin text-sky-400' : ''}`}
            />
          </button>
        </div>
      </header>

      {/* LEFT DOCKED HUD: MULTI-SENSOR OBSERVATION STACK */}
      <MultiSensorObservationDock
        bundle={bundle}
        layers={layers}
        onUpdateLayers={setLayers}
        selectedStationId={selectedStationId}
        onSelectStation={(st) => setSelectedStationId(st.id)}
        selectedCellId={selectedCellId}
        onSelectCell={(cell) => setSelectedCellId(cell.id)}
        perturbation={perturbation}
      />

      {/* RIGHT DOCKED HUD: AIML MULTI-SENSOR FUSION & NOWCAST ENGINE */}
      <AiNowcastWorkstationDock
        bundle={bundle}
        nowcast={nowcast}
        isLoadingNowcast={isLoadingNowcast}
        onRunNowcast={(customPerturb) => {
          if (bundle) {
            void runAiNowcast(bundle, customPerturb ?? perturbation);
          }
        }}
        selectedNowcastMinute={selectedNowcastMinute}
        onSelectNowcastMinute={setSelectedNowcastMinute}
        perturbation={perturbation}
        onUpdatePerturbation={setPerturbation}
      />

      {/* BOTTOM TIMELINE SCRUBBER HUD */}
      <footer className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(780px,calc(100vw-32px))] bg-[#0F1622]/92 backdrop-blur-md border border-slate-800/90 rounded-lg px-3.5 py-2 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-3 pointer-events-auto">
        {/* Radar & Satellite Frame Scrubber */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto flex-1">
          <button
            onClick={() => setIsPlayingTimeline((p) => !p)}
            className="w-7 h-7 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            title={isPlayingTimeline ? 'Pause Radar Loop' : 'Play Radar & Nowcast Loop'}
          >
            {isPlayingTimeline ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => {
              if (!bundle || bundle.radarFrames.length === 0) return;
              setActiveRadarFrameIndex(
                (prev) =>
                  (prev - 1 + bundle.radarFrames.length) %
                  bundle.radarFrames.length
              );
            }}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between text-[10px] font-mono mb-1">
              <span className="text-slate-300 font-semibold">
                {currentRadarFrame?.label || 'RADAR COMPOSITE SCAN'}
              </span>
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] ${
                  currentRadarFrame?.isNowcast
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                }`}
              >
                {currentRadarFrame?.isNowcast
                  ? 'OPTICAL-FLOW EXTRAPOLATION'
                  : 'OBSERVED DOPPLER COMPOSITE'}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(0, (bundle?.radarFrames.length ?? 1) - 1)}
              value={activeRadarFrameIndex}
              onChange={(e) => {
                setIsPlayingTimeline(false);
                setActiveRadarFrameIndex(Number(e.target.value));
              }}
              className="w-full accent-sky-400 cursor-pointer h-1.5"
            />
          </div>

          <button
            onClick={() => {
              if (!bundle || bundle.radarFrames.length === 0) return;
              setActiveRadarFrameIndex(
                (prev) => (prev + 1) % bundle.radarFrames.length
              );
            }}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="hidden sm:block h-7 w-px bg-slate-800" />

        {/* AI Isochrone Lead-Time Selector (+15m to +120m) */}
        <div className="flex items-center gap-1 font-mono">
          <span className="text-[9.5px] text-slate-400 uppercase mr-1 flex items-center gap-1">
            <Activity className="w-3 h-3 text-rose-400" />
            Isochrone:
          </span>
          {[15, 30, 45, 60, 90, 120].map((min) => (
            <button
              key={min}
              onClick={() => setSelectedNowcastMinute(min)}
              className={`px-1.5 py-1 rounded text-[10px] transition-colors cursor-pointer ${
                selectedNowcastMinute === min
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'bg-[#080C14] hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              +{min}m
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
