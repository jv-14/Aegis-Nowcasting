import React, { useState } from 'react';
import {
  Layers,
  Radio,
  Satellite,
  Zap,
  Thermometer,
  Wind,
  Navigation,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
} from 'lucide-react';
import type {
  ObservationBundle,
  DopplerRadarStation,
  ConvectiveCell,
  PerturbationParams,
} from '../types/nowcast';
import type { MapLayerState } from './MultiSensorMap';
import { SkewTSoundingPlot } from './SkewTSoundingPlot';

interface MultiSensorObservationDockProps {
  bundle: ObservationBundle | null;
  layers: MapLayerState;
  onUpdateLayers: (updater: (prev: MapLayerState) => MapLayerState) => void;
  selectedStationId: string | null;
  onSelectStation: (st: DopplerRadarStation) => void;
  selectedCellId: string | null;
  onSelectCell: (cell: ConvectiveCell) => void;
  perturbation: PerturbationParams;
}

export const MultiSensorObservationDock: React.FC<
  MultiSensorObservationDockProps
> = ({
  bundle,
  layers,
  onUpdateLayers,
  selectedStationId,
  onSelectStation,
  selectedCellId,
  onSelectCell,
  perturbation,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'RADAR' | 'SAT_LTG' | 'NWP'>('RADAR');

  if (collapsed) {
    return (
      <div className="absolute top-16 left-4 z-20 pointer-events-auto">
        <button
          onClick={() => setCollapsed(false)}
          className="bg-[#0F1622]/90 backdrop-blur-md border border-slate-700/80 hover:border-sky-500/60 text-slate-200 px-3 py-2 rounded-md shadow-xl flex items-center gap-2 text-xs font-mono transition-colors"
        >
          <Layers className="w-4 h-4 text-sky-400" />
          <span>SENSORS & LAYERS</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    );
  }

  const cgPlusCount =
    bundle?.lightningStrikes.filter((s) => s.polarity === 'CG+').length ?? 0;
  const cgMinusCount =
    bundle?.lightningStrikes.filter((s) => s.polarity === 'CG-').length ?? 0;
  const icCount =
    bundle?.lightningStrikes.filter((s) => s.polarity === 'IC').length ?? 0;
  const totalStrikes = Math.max(1, cgPlusCount + cgMinusCount + icCount);

  return (
    <aside className="absolute top-16 left-4 bottom-20 w-[350px] max-w-[calc(100vw-32px)] z-20 pointer-events-auto flex flex-col bg-[#0F1622]/90 backdrop-blur-md border border-slate-800/90 rounded-lg shadow-2xl overflow-hidden">
      {/* Dock Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-800/90 flex items-center justify-between bg-[#080C14]/60">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-sky-400" />
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-100">
              Atmospheric Observation Stack
            </h2>
            <p className="text-[10px] font-mono text-slate-400">
              Multi-Radar · GOES-IR · GLM · NWP Sounding
            </p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="Collapse Panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Spatial Map Layer Toggles & Base Cartography Mode */}
      <div className="p-3 border-b border-slate-800/90 bg-[#080C14]/35">
        {/* Base Cartography Mode Selector */}
        <div className="mb-2.5 pb-2 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Base Map Mode
            </span>
            <span className="text-[9.5px] font-mono text-sky-400">
              {(layers.baseMapMode || 'DARK_TACTICAL').replace(/_/g, ' ')}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1 font-mono text-[9px]">
            {(
              [
                { id: 'AUTO_DAY_NIGHT', label: 'AUTO' },
                { id: 'DARK_TACTICAL', label: 'DARK' },
                { id: 'HYBRID_SAT', label: 'HYBRID' },
                { id: 'SATELLITE_RAW', label: 'SAT' },
                { id: 'TERRAIN_TOPO', label: 'TOPO' },
                { id: 'LIGHT_DAY', label: 'LIGHT' },
              ] as const
            ).map((mode) => {
              const isCurrent = (layers.baseMapMode || 'DARK_TACTICAL') === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() =>
                    onUpdateLayers((prev) => ({
                      ...prev,
                      baseMapMode: mode.id,
                    }))
                  }
                  className={`py-1 px-0.5 rounded border text-center transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-bold shadow-sm'
                      : 'bg-[#080C14]/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Geospatial Sensor Overlays
          </span>
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
            <span>Radar Opacity</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={layers.radarOpacity}
              onChange={(e) =>
                onUpdateLayers((prev) => ({
                  ...prev,
                  radarOpacity: Number(e.target.value),
                }))
              }
              className="w-16 accent-sky-400 cursor-pointer"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
          {[
            { key: 'radar', label: 'RADAR COMPOSITE', color: 'text-sky-400' },
            { key: 'satellite', label: 'GOES / IR CLOUD', color: 'text-teal-400' },
            { key: 'lightning', label: 'GLM STRIKE NODES', color: 'text-amber-400' },
            { key: 'lightningHeatmap', label: 'GLM FLASH HEATMAP', color: 'text-orange-400' },
            { key: 'nowcastCones', label: 'AI TRACK CONES', color: 'text-rose-400' },
            { key: 'solarTerminator', label: 'SOLAR TERMINATOR', color: 'text-yellow-400' },
            { key: 'radarBeams', label: 'DOPPLER BEAMS', color: 'text-indigo-400' },
            { key: 'nwpGrid', label: 'NWP MESO-GRID', color: 'text-emerald-400' },
          ].map((item) => {
            const active =
              item.key === 'solarTerminator'
                ? layers.solarTerminator !== false
                : Boolean(layers[item.key as keyof MapLayerState]);
            return (
              <button
                key={item.key}
                onClick={() =>
                  onUpdateLayers((prev) => ({
                    ...prev,
                    [item.key]:
                      item.key === 'solarTerminator'
                        ? prev.solarTerminator === false
                          ? true
                          : false
                        : !prev[item.key as keyof MapLayerState],
                  }))
                }
                className={`flex items-center justify-between px-2 py-1.5 rounded border text-left transition-all ${
                  active
                    ? 'bg-slate-800/90 border-sky-500/50 text-slate-100'
                    : 'bg-[#080C14]/60 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="truncate text-[10px] font-medium">
                  {item.label}
                </span>
                {active ? (
                  <Eye className={`w-3.5 h-3.5 shrink-0 ${item.color}`} />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 shrink-0 text-slate-600" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sensor Telemetry Selector Tabs */}
      <div className="grid grid-cols-3 border-b border-slate-800/90 bg-[#080C14]/50 text-[11px] font-mono">
        <button
          onClick={() => setActiveTab('RADAR')}
          className={`py-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === 'RADAR'
              ? 'border-sky-400 text-sky-300 bg-sky-500/10 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>RADARS ({bundle?.radarStations.length ?? 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('SAT_LTG')}
          className={`py-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === 'SAT_LTG'
              ? 'border-amber-400 text-amber-300 bg-amber-500/10 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>SAT & LTG</span>
        </button>
        <button
          onClick={() => setActiveTab('NWP')}
          className={`py-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === 'NWP'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Thermometer className="w-3.5 h-3.5" />
          <span>SOUNDING</span>
        </button>
      </div>

      {/* Scrollable Telemetry Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Real-Time Surface Weather & Diurnal Solar Card (Always Live from Open-Meteo) */}
        {bundle?.realtimeWeather && bundle?.diurnal && (
          <div className="p-2.5 rounded-md border border-slate-800/90 bg-[#080C14]/90 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
              <div className="flex items-center gap-1.5">
                {bundle.diurnal.isDay ? (
                  <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                )}
                <span
                  className={`font-mono text-[10px] font-bold uppercase ${
                    bundle.diurnal.isDay ? 'text-amber-300' : 'text-indigo-300'
                  }`}
                >
                  {bundle.diurnal.isDay ? 'DAYLIGHT' : 'NIGHTTIME'} ·{' '}
                  {bundle.diurnal.diurnalPhaseLabel ||
                    (bundle.diurnal.phase || 'DAYLIGHT').replace(/_/g, ' ')}
                </span>
              </div>
              <span className="font-mono text-[10px] text-slate-300 font-semibold">
                {bundle.diurnal.localTimeFormatted}
              </span>
            </div>

            <div className="flex items-center justify-between font-mono">
              <div>
                <div className="text-xs font-bold text-slate-100">
                  {bundle.realtimeWeather.weatherDescription ||
                    bundle.realtimeWeather.weatherConditionLabel ||
                    'Clear Sky'}
                </div>
                <div className="text-[9.5px] text-slate-400">
                  Sunrise {bundle.diurnal.sunriseLocal} · Sunset {bundle.diurnal.sunsetLocal} (
                  {bundle.diurnal.daylightDurationHours ?? bundle.diurnal.daylightHours ?? 12}h)
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-sky-300">
                  {bundle.realtimeWeather.temp2mC}°C
                </div>
                <div className="text-[9px] text-slate-400">
                  Feels{' '}
                  {bundle.realtimeWeather.feelsLikeC ??
                    bundle.realtimeWeather.apparentTempC ??
                    bundle.realtimeWeather.temp2mC}
                  °C · Td {bundle.realtimeWeather.dewpoint2mC}°C
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 pt-1 border-t border-slate-800/70 text-center font-mono text-[9.5px]">
              <div className="bg-[#0F1622] py-1 px-1 rounded border border-slate-800/70">
                <span className="text-[8px] text-slate-500 block">SOLAR ELEV</span>
                <span className="text-amber-300 font-bold">
                  {bundle.diurnal.solarElevationDeg > 0 ? '+' : ''}
                  {bundle.diurnal.solarElevationDeg}°
                </span>
              </div>
              <div className="bg-[#0F1622] py-1 px-1 rounded border border-slate-800/70">
                <span className="text-[8px] text-slate-500 block">IRRADIANCE</span>
                <span className="text-yellow-300 font-bold">
                  {bundle.diurnal.shortwaveRadiationWm2} W/m²
                </span>
              </div>
              <div className="bg-[#0F1622] py-1 px-1 rounded border border-slate-800/70">
                <span className="text-[8px] text-slate-500 block">WIND / GUST</span>
                <span className="text-sky-300 font-bold">
                  {bundle.realtimeWeather.windSpeed10mKt}/
                  {bundle.realtimeWeather.windGust10mKt ??
                    bundle.realtimeWeather.windGusts10mKt ??
                    bundle.realtimeWeather.windSpeed10mKt}
                  kt
                </span>
              </div>
              <div className="bg-[#0F1622] py-1 px-1 rounded border border-slate-800/70">
                <span className="text-[8px] text-slate-500 block">PRECIP / RH</span>
                <span className="text-emerald-300 font-bold">
                  {bundle.realtimeWeather.precipMmHr}mm ·{' '}
                  {bundle.realtimeWeather.relHumidityPct ??
                    bundle.realtimeWeather.relativeHumidityPct ??
                    60}
                  %
                </span>
              </div>
            </div>
          </div>
        )}

        {!bundle ? (
          <div className="space-y-2">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-20 rounded-md bg-slate-800/40 animate-pulse border border-slate-800"
              />
            ))}
          </div>
        ) : activeTab === 'RADAR' ? (
          <>
            <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-400">
              <span>POLARIMETRIC RADAR TRIANGULATION</span>
              <span className="text-sky-400">4/3 Re BEAM PROPAGATION</span>
            </div>

            <div className="space-y-2">
              {bundle.radarStations.map((st) => {
                const isSelected = selectedStationId === st.id;
                return (
                  <div
                    key={st.id}
                    onClick={() => onSelectStation(st)}
                    className={`p-2.5 rounded-md border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-sky-950/40 border-sky-400/80 shadow-md'
                        : 'bg-[#080C14]/80 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="font-mono text-xs font-bold text-slate-100">
                          {st.id}
                        </span>
                        <span className="text-[11px] text-slate-300 truncate max-w-[140px]">
                          {st.name}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                        {st.band}
                      </span>
                    </div>

                    <div className="text-[10px] font-mono text-slate-400 mb-2 flex items-center justify-between">
                      <span>{st.network}</span>
                      <span>
                        RNG {st.distanceKm}km · AZ {st.azimuthDeg}°
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-1 pt-1.5 border-t border-slate-800/80 text-center font-mono">
                      <div>
                        <span className="text-[9px] text-slate-500 block">MAX Z</span>
                        <span
                          className={`text-[11px] font-bold ${
                            st.maxDbz >= 50
                              ? 'text-rose-400'
                              : st.maxDbz >= 35
                              ? 'text-amber-300'
                              : 'text-emerald-400'
                          }`}
                        >
                          {st.maxDbz}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">VIL</span>
                        <span className="text-[11px] text-slate-200">
                          {st.vilKgM2}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">TOP</span>
                        <span className="text-[11px] text-slate-200">
                          {st.echoTopKm}km
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">ZDR</span>
                        <span className="text-[11px] text-sky-300">
                          +{st.zdrDb}dB
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">BEAM H</span>
                        <span className="text-[11px] text-amber-300">
                          {st.beamHeightKm}km
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : activeTab === 'SAT_LTG' ? (
          <>
            {/* Satellite IR & Tracked Convective Cells */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-400">
                <span className="flex items-center gap-1">
                  <Satellite className="w-3.5 h-3.5 text-teal-400" />
                  CONVECTIVE CELLS & GOES-IR ANVIL
                </span>
                <span>{bundle.convectiveCells.length} TRACKED</span>
              </div>

              {bundle.convectiveCells.map((cell) => {
                const isSelected = selectedCellId === cell.id;
                const isSevere =
                  cell.severity === 'TORNADIC_SUPERCELL' ||
                  cell.severity === 'SEVERE';

                return (
                  <div
                    key={cell.id}
                    onClick={() => onSelectCell(cell)}
                    className={`p-2.5 rounded-md border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-rose-950/30 border-rose-500/80'
                        : 'bg-[#080C14]/80 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold text-slate-100">
                        {cell.label}
                      </span>
                      <span
                        className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded font-semibold ${
                          isSevere
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {cell.severity.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 mt-2 font-mono text-center bg-[#0F1622]/80 p-1.5 rounded border border-slate-800/70">
                      <div>
                        <span className="text-[9px] text-slate-500 block">IR Tb</span>
                        <span className="text-[11px] text-teal-300 font-semibold">
                          {cell.cloudTopTempC}°C
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">COOLING</span>
                        <span className="text-[11px] text-sky-300">
                          {cell.coolingRateCPer15m}°/15m
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">FLASH/M</span>
                        <span className="text-[11px] text-amber-400 font-bold">
                          {cell.flashRatePerMin}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">IC:CG</span>
                        <span className="text-[11px] text-slate-200">
                          {cell.icToCgRatio}:1
                        </span>
                      </div>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span className="flex items-center gap-1">
                        <Navigation
                          className="w-3 h-3 text-sky-400"
                          style={{ transform: `rotate(${cell.headingDeg}deg)` }}
                        />
                        Advecting {cell.headingDeg}° at {cell.speedKmh} km/h
                      </span>
                      <span>VIL {cell.vilKgM2} kg/m²</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* GLM / VLF Lightning Polarity Distribution & Gridded FED/TOE Diagnostics */}
            <div className="bg-[#080C14]/80 border border-slate-800/90 rounded-md p-2.5 space-y-2.5">
              <div>
                <div className="flex items-center justify-between text-[10.5px] font-mono mb-1.5">
                  <span className="text-slate-300">GLM / VLF POLARITY BREAKDOWN</span>
                  <span className="text-amber-400">
                    {bundle.lightningStrikes.length} DETECTIONS
                  </span>
                </div>

                <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-900 mb-2">
                  <div
                    style={{ width: `${(icCount / totalStrikes) * 100}%` }}
                    className="bg-sky-400"
                    title="Intra-Cloud (IC)"
                  />
                  <div
                    style={{ width: `${(cgMinusCount / totalStrikes) * 100}%` }}
                    className="bg-amber-400"
                    title="Negative Cloud-to-Ground (CG-)"
                  />
                  <div
                    style={{ width: `${(cgPlusCount / totalStrikes) * 100}%` }}
                    className="bg-rose-500"
                    title="Positive Cloud-to-Ground (CG+)"
                  />
                </div>

                <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-center">
                  <div className="bg-[#0F1622] p-1 rounded border border-slate-800">
                    <span className="text-sky-400 font-bold">{icCount}</span>{' '}
                    <span className="text-slate-400">IC</span>
                  </div>
                  <div className="bg-[#0F1622] p-1 rounded border border-slate-800">
                    <span className="text-amber-400 font-bold">{cgMinusCount}</span>{' '}
                    <span className="text-slate-400">CG-</span>
                  </div>
                  <div className="bg-[#0F1622] p-1 rounded border border-slate-800">
                    <span className="text-rose-400 font-bold">{cgPlusCount}</span>{' '}
                    <span className="text-slate-400">CG+</span>
                  </div>
                </div>
              </div>

              {/* GOES-R GLM Gridded Heatmap Telemetry Summary */}
              {(() => {
                const leadCell = bundle.convectiveCells[0];
                const peakFed = leadCell ? leadCell.flashRatePerMin : 0;
                const totalOpticalEnergyFj = Math.round(
                  bundle.lightningStrikes.reduce(
                    (acc, s) => acc + Math.abs(s.peakCurrentKa) * s.multiplicity * 0.65,
                    0
                  )
                );
                const minFlashAreaKm2 = leadCell
                  ? Math.max(18, Math.round(130 - leadCell.maxDbz * 1.6))
                  : 85;
                const jumpSigma = leadCell
                  ? Number(
                      Math.min(
                        4.2,
                        (leadCell.flashRatePerMin / 10) * 0.85 +
                          Math.abs(leadCell.coolingRateCPer15m) / 4.2 +
                          (leadCell.maxDbz >= 52 ? 0.9 : 0.2)
                      ).toFixed(2)
                    )
                  : 0.4;

                return (
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5">
                      <span>GOES-R GLM GRIDDED TELEMETRY</span>
                      <span
                        className={
                          layers.lightningHeatmap ? 'text-orange-400' : 'text-slate-500'
                        }
                      >
                        {layers.lightningHeatmap ? 'HEATMAP ACTIVE' : 'HEATMAP OFF'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                      <div className="bg-[#0F1622] p-1.5 rounded border border-slate-800">
                        <span className="text-[8.5px] text-slate-500 block">
                          PEAK FED CORE
                        </span>
                        <span className="text-amber-300 font-bold">
                          {peakFed} fl/min
                        </span>
                      </div>
                      <div className="bg-[#0F1622] p-1.5 rounded border border-slate-800">
                        <span className="text-[8.5px] text-slate-500 block">
                          OPTICAL ENERGY (TOE)
                        </span>
                        <span className="text-fuchsia-300 font-bold">
                          {totalOpticalEnergyFj} fJ
                        </span>
                      </div>
                      <div className="bg-[#0F1622] p-1.5 rounded border border-slate-800">
                        <span className="text-[8.5px] text-slate-500 block">
                          MIN FLASH AREA (MFA)
                        </span>
                        <span className="text-cyan-300 font-bold">
                          {minFlashAreaKm2} km²
                        </span>
                      </div>
                      <div className="bg-[#0F1622] p-1.5 rounded border border-slate-800">
                        <span className="text-[8.5px] text-slate-500 block">
                          LIGHTNING JUMP (LJA)
                        </span>
                        <span
                          className={`font-bold ${
                            jumpSigma >= 2.0
                              ? 'text-rose-400'
                              : jumpSigma >= 1.0
                              ? 'text-amber-300'
                              : 'text-emerald-400'
                          }`}
                        >
                          {jumpSigma >= 2.0 ? `+${jumpSigma}σ ALERT` : `+${jumpSigma}σ`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        ) : (
          /* NWP SOUNDING & THERMODYNAMICS TAB */
          <div className="space-y-2.5">
            <SkewTSoundingPlot
              sounding={bundle.nwp.sounding}
              capeJkg={bundle.nwp.capeJkg}
              cinJkg={bundle.nwp.cinJkg}
              freezingLevelM={bundle.nwp.freezingLevelM}
              deltaTempC={perturbation.deltaTempC}
              deltaDewpointC={perturbation.deltaDewpointC}
            />

            <div className="bg-[#080C14]/85 border border-slate-800/90 rounded-md p-2.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                <span>NWP Convective Parameters</span>
                <span className="text-emerald-400">{bundle.nwp.runTimeUtc}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <div className="bg-[#0F1622] p-2 rounded border border-slate-800/80">
                  <span className="text-[9.5px] text-slate-500 block">
                    850–500 hPa LAPSE RATE
                  </span>
                  <span className="text-slate-100 font-bold">
                    {bundle.nwp.lapseRate850To500CPerKm} °C/km
                  </span>
                </div>
                <div className="bg-[#0F1622] p-2 rounded border border-slate-800/80">
                  <span className="text-[9.5px] text-slate-500 block">
                    0–6 km BULK WIND SHEAR
                  </span>
                  <span className="text-sky-300 font-bold">
                    {Math.max(0, bundle.nwp.bulkShear0To6KmKt + perturbation.deltaShearKt)} kt
                  </span>
                </div>
                <div className="bg-[#0F1622] p-2 rounded border border-slate-800/80">
                  <span className="text-[9.5px] text-slate-500 block">
                    LIFTED INDEX / K-INDEX
                  </span>
                  <span className="text-amber-300 font-bold">
                    {bundle.nwp.liftedIndexC}°C / KI {bundle.nwp.kIndex}
                  </span>
                </div>
                <div className="bg-[#0F1622] p-2 rounded border border-slate-800/80">
                  <span className="text-[9.5px] text-slate-500 block">
                    PRECIPITABLE WATER (PWAT)
                  </span>
                  <span className="text-emerald-300 font-bold">
                    {bundle.nwp.precipitableWaterMm} mm
                  </span>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10.5px] font-mono text-slate-300">
                <span className="flex items-center gap-1 text-slate-400">
                  <Wind className="w-3.5 h-3.5 text-sky-400" />
                  700–500 hPa Steering:
                </span>
                <span>
                  {bundle.nwp.steeringWindDirDeg}° @ {bundle.nwp.steeringWindSpeedKt} kt
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
