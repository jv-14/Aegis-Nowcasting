import React from 'react';
import type { PressureLevelObs } from '../types/nowcast';

interface SkewTSoundingPlotProps {
  sounding: PressureLevelObs[];
  capeJkg: number;
  cinJkg: number;
  freezingLevelM: number;
  deltaTempC?: number;
  deltaDewpointC?: number;
}

export const SkewTSoundingPlot: React.FC<SkewTSoundingPlotProps> = ({
  sounding,
  capeJkg,
  cinJkg,
  freezingLevelM,
  deltaTempC = 0,
  deltaDewpointC = 0,
}) => {
  if (!sounding || sounding.length === 0) return null;

  const width = 310;
  const height = 210;
  const padLeft = 38;
  const padRight = 46;
  const padTop = 16;
  const padBottom = 24;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Pressure log scale from 1000 hPa (bottom) to 300 hPa (top)
  const logPMin = Math.log10(300);
  const logPMax = Math.log10(1000);

  const pToY = (p: number) => {
    const ratio = (Math.log10(p) - logPMin) / (logPMax - logPMin);
    return padTop + ratio * plotH;
  };

  // Skewed temperature scale (-55C to +40C at 1000hPa, with +18C skew towards top)
  const tempMin = -50;
  const tempMax = 42;
  const tempToX = (t: number, p: number) => {
    const yRatio = 1 - (Math.log10(p) - logPMin) / (logPMax - logPMin); // 0 at bottom, 1 at top
    const skewOffset = yRatio * 18;
    const normT = (t + skewOffset - tempMin) / (tempMax - tempMin);
    return padLeft + Math.max(0, Math.min(1, normT)) * plotW;
  };

  // Apply interactive user perturbations primarily in the boundary layer (1000-850 hPa)
  const modifiedSounding = sounding.map((obs) => {
    const blWeight = obs.pressureHpa >= 850 ? 1 : obs.pressureHpa >= 700 ? 0.4 : 0;
    return {
      ...obs,
      tempC: Number((obs.tempC + deltaTempC * blWeight).toFixed(1)),
      dewpointC: Number((obs.dewpointC + deltaDewpointC * blWeight).toFixed(1)),
    };
  });

  // Build SVG polyline points for Environmental Temp (Red) and Dewpoint (Emerald)
  const tempPoints = modifiedSounding
    .map((s) => `${tempToX(s.tempC, s.pressureHpa).toFixed(1)},${pToY(s.pressureHpa).toFixed(1)}`)
    .join(' ');

  const dewPoints = modifiedSounding
    .map((s) => `${tempToX(s.dewpointC, s.pressureHpa).toFixed(1)},${pToY(s.pressureHpa).toFixed(1)}`)
    .join(' ');

  // Compute Lifted Parcel Ascent Trajectory (dry adiabatic to LCL ~875hPa, then moist adiabatic)
  const sfc = modifiedSounding[0];
  const parcelPoints = modifiedSounding.map((s) => {
    let parcelT = s.tempC;
    if (s.pressureHpa === 1000) {
      parcelT = sfc.tempC;
    } else {
      // Moist adiabatic cooling approximation lifted from surface temp + dewpoint buoyancy
      const capeLiftBoost = Math.min(7.5, Math.max(0.5, (capeJkg + deltaTempC * 180 + deltaDewpointC * 260) / 420));
      parcelT = s.tempC + (s.pressureHpa <= 850 ? capeLiftBoost : 0.8);
    }
    return {
      x: tempToX(parcelT, s.pressureHpa),
      y: pToY(s.pressureHpa),
    };
  });

  const parcelPolyline = parcelPoints.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');

  // Closed polygon between Environmental Temp and Parcel Path to shade CAPE positive area
  const capePolygonPoints = [
    ...modifiedSounding.map((s) => `${tempToX(s.tempC, s.pressureHpa).toFixed(1)},${pToY(s.pressureHpa).toFixed(1)}`),
    ...[...parcelPoints].reverse().map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`),
  ].join(' ');

  // 0°C Isotherm skewed line
  const zeroIsoBottomX = tempToX(0, 1000);
  const zeroIsoTopX = tempToX(0, 300);

  return (
    <div className="bg-[#080C14]/90 border border-slate-800/80 rounded-md p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            Skew-T Log-P Profile
          </span>
          <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">
            1000–300 hPa
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] font-mono">
          <span className="flex items-center gap-1 text-rose-400">
            <span className="w-2 h-0.5 bg-rose-500 inline-block" /> T
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-2 h-0.5 bg-emerald-500 inline-block" /> Td
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <span className="w-2 h-0.5 bg-amber-400 border-b border-dashed inline-block" /> Parcel
          </span>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <defs>
          <linearGradient id="capeShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#F43F5E" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* Horizontal Isobars */}
        {modifiedSounding.map((s) => {
          const y = pToY(s.pressureHpa);
          return (
            <g key={s.pressureHpa}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="rgba(148, 163, 184, 0.14)"
                strokeDasharray={s.pressureHpa === 500 || s.pressureHpa === 850 ? 'none' : '2 2'}
              />
              <text
                x={padLeft - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 font-mono text-[9px]"
              >
                {s.pressureHpa}
              </text>
            </g>
          );
        })}

        {/* 0°C Freezing Isotherm Line */}
        <line
          x1={zeroIsoBottomX}
          y1={pToY(1000)}
          x2={zeroIsoTopX}
          y2={pToY(300)}
          stroke="rgba(56, 189, 248, 0.35)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <text
          x={zeroIsoTopX + 2}
          y={padTop + 8}
          className="fill-sky-400/80 font-mono text-[8px]"
        >
          0°C
        </text>

        {/* Positive Buoyancy (CAPE) Area Fill */}
        <polygon points={capePolygonPoints} fill="url(#capeShade)" />

        {/* Dewpoint Profile (Td - Emerald) */}
        <polyline
          fill="none"
          stroke="#10B981"
          strokeWidth="2"
          points={dewPoints}
        />

        {/* Environmental Temperature Profile (T - Rose) */}
        <polyline
          fill="none"
          stroke="#F43F5E"
          strokeWidth="2"
          points={tempPoints}
        />

        {/* Parcel Ascent Curve (Amber Dashed) */}
        <polyline
          fill="none"
          stroke="#F59E0B"
          strokeWidth="1.5"
          strokeDasharray="4 2"
          points={parcelPolyline}
        />

        {/* Nodes & Right-side Wind Vector Barbs */}
        {modifiedSounding.map((s) => {
          const y = pToY(s.pressureHpa);
          const tx = tempToX(s.tempC, s.pressureHpa);
          const dx = tempToX(s.dewpointC, s.pressureHpa);
          const barbX = width - padRight + 18;
          const rad = ((s.windDirDeg - 90) * Math.PI) / 180;
          const vecLen = Math.min(12, Math.max(5, s.windSpeedKt / 5));
          const vx = barbX + Math.cos(rad) * vecLen;
          const vy = y + Math.sin(rad) * vecLen;

          return (
            <g key={`pts-${s.pressureHpa}`}>
              <circle cx={tx} cy={y} r="2.3" fill="#F43F5E" />
              <circle cx={dx} cy={y} r="2.3" fill="#10B981" />
              {/* Wind direction staff & speed label */}
              <line
                x1={barbX}
                y1={y}
                x2={vx}
                y2={vy}
                stroke="#38BDF8"
                strokeWidth="1.4"
              />
              <circle cx={barbX} cy={y} r="1.6" fill="#38BDF8" />
              <text
                x={width - 2}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 font-mono text-[8.5px]"
              >
                {s.windSpeedKt}kt
              </text>
            </g>
          );
        })}

        {/* Bottom Temperature Axis Labels */}
        {[-30, -10, 0, 10, 25, 35].map((t) => {
          const x = tempToX(t, 1000);
          return (
            <text
              key={`t-lbl-${t}`}
              x={x}
              y={height - 6}
              textAnchor="middle"
              className="fill-slate-500 font-mono text-[8.5px]"
            >
              {t}°
            </text>
          );
        })}
      </svg>

      <div className="grid grid-cols-3 gap-1.5 mt-1 pt-1.5 border-t border-slate-800/80 text-[10px] font-mono">
        <div>
          <span className="text-slate-500 block">EFF. CAPE</span>
          <span className="text-amber-400 font-semibold">
            {Math.max(0, Math.round(capeJkg + deltaTempC * 180 + deltaDewpointC * 260))} J/kg
          </span>
        </div>
        <div>
          <span className="text-slate-500 block">CIN (CAP)</span>
          <span className="text-sky-300 font-semibold">{cinJkg} J/kg</span>
        </div>
        <div>
          <span className="text-slate-500 block">FREEZING LVL</span>
          <span className="text-slate-200 font-semibold">{freezingLevelM} m</span>
        </div>
      </div>
    </div>
  );
};
