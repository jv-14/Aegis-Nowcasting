import React from 'react';
import type { NowcastTimelineProjection } from '../types/nowcast';

interface NowcastEvolutionChartProps {
  projections: NowcastTimelineProjection[];
  selectedMinuteOffset: number;
  onSelectMinuteOffset: (min: number) => void;
}

export const NowcastEvolutionChart: React.FC<NowcastEvolutionChartProps> = ({
  projections,
  selectedMinuteOffset,
  onSelectMinuteOffset,
}) => {
  if (!projections || projections.length === 0) return null;

  const width = 330;
  const height = 148;
  const padLeft = 28;
  const padRight = 28;
  const padTop = 14;
  const padBottom = 22;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxDbz = 70;
  const maxFlash = Math.max(25, ...projections.map((p) => p.expectedFlashRate * 1.2));

  const idxToX = (idx: number) => {
    if (projections.length <= 1) return padLeft;
    return padLeft + (idx / (projections.length - 1)) * plotW;
  };

  const dbzToY = (dbz: number) => {
    const clamped = Math.max(0, Math.min(maxDbz, dbz));
    return padTop + plotH - (clamped / maxDbz) * plotH;
  };

  const flashToY = (flash: number) => {
    const clamped = Math.max(0, Math.min(maxFlash, flash));
    return padTop + plotH - (clamped / maxFlash) * plotH;
  };

  const probToY = (prob: number) => {
    const clamped = Math.max(0, Math.min(100, prob));
    return padTop + plotH - (clamped / 100) * plotH;
  };

  const dbzLine = projections
    .map((p, idx) => `${idxToX(idx).toFixed(1)},${dbzToY(p.expectedDbz).toFixed(1)}`)
    .join(' ');

  const flashLine = projections
    .map((p, idx) => `${idxToX(idx).toFixed(1)},${flashToY(p.expectedFlashRate).toFixed(1)}`)
    .join(' ');

  const probArea = [
    `${idxToX(0).toFixed(1)},${(padTop + plotH).toFixed(1)}`,
    ...projections.map((p, idx) => `${idxToX(idx).toFixed(1)},${probToY(p.convectiveProbPct).toFixed(1)}`),
    `${idxToX(projections.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)}`,
  ].join(' ');

  const activePoint =
    projections.find((p) => p.minuteOffset === selectedMinuteOffset) || projections[0];

  return (
    <div className="bg-[#080C14]/90 border border-slate-800/80 rounded-md p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          0–120m Nowcast Trajectory
        </span>
        <div className="flex items-center gap-2.5 text-[10px] font-mono">
          <span className="flex items-center gap-1 text-rose-400">
            <span className="w-2 h-0.5 bg-rose-500 inline-block" /> dBZ
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <span className="w-2 h-0.5 bg-amber-400 inline-block" /> Fl/m
          </span>
          <span className="flex items-center gap-1 text-sky-400">
            <span className="w-2 h-1.5 bg-sky-500/30 border border-sky-400/50 inline-block" /> Prob%
          </span>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <defs>
          <linearGradient id="probGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal Reference Lines (20, 40, 60 dBZ) */}
        {[20, 40, 60].map((val) => {
          const y = dbzToY(val);
          return (
            <g key={val}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="rgba(148, 163, 184, 0.12)"
                strokeDasharray="2 2"
              />
              <text
                x={padLeft - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-rose-400/75 font-mono text-[8.5px]"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Convective Probability Shaded Area */}
        <polygon points={probArea} fill="url(#probGrad)" />

        {/* Reflectivity Curve (dBZ) */}
        <polyline fill="none" stroke="#F43F5E" strokeWidth="2" points={dbzLine} />

        {/* Flash Rate Curve (fl/min) */}
        <polyline
          fill="none"
          stroke="#F59E0B"
          strokeWidth="1.8"
          strokeDasharray="3 2"
          points={flashLine}
        />

        {/* Interactive Time Step Nodes */}
        {projections.map((p, idx) => {
          const x = idxToX(idx);
          const yd = dbzToY(p.expectedDbz);
          const yf = flashToY(p.expectedFlashRate);
          const isSelected = p.minuteOffset === activePoint.minuteOffset;

          return (
            <g
              key={p.minuteOffset}
              className="cursor-pointer"
              onClick={() => onSelectMinuteOffset(p.minuteOffset)}
            >
              {isSelected && (
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={padTop + plotH}
                  stroke="#38BDF8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}
              <circle
                cx={x}
                cy={yd}
                r={isSelected ? 4 : 2.5}
                fill={isSelected ? '#F43F5E' : '#0F1622'}
                stroke="#F43F5E"
                strokeWidth="1.8"
              />
              <circle
                cx={x}
                cy={yf}
                r={isSelected ? 3.8 : 2.2}
                fill={isSelected ? '#F59E0B' : '#0F1622'}
                stroke="#F59E0B"
                strokeWidth="1.5"
              />
              <text
                x={x}
                y={height - 5}
                textAnchor="middle"
                className={`font-mono text-[8.5px] ${
                  isSelected ? 'fill-sky-300 font-bold' : 'fill-slate-400'
                }`}
              >
                {p.minuteOffset === 0 ? 'NOW' : `+${p.minuteOffset}m`}
              </text>
            </g>
          );
        })}

        {/* Right Axis Flash Rate Labels */}
        {[0, Math.round(maxFlash / 2), Math.round(maxFlash)].map((fVal, i) => {
          const y = flashToY(fVal);
          return (
            <text
              key={`f-axis-${i}`}
              x={width - padRight + 4}
              y={y + 3}
              textAnchor="start"
              className="fill-amber-400/75 font-mono text-[8.5px]"
            >
              {fVal}
            </text>
          );
        })}
      </svg>

      {/* Selected Time-Step Physical Diagnostics Readout */}
      <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex flex-col gap-1 text-[11px]">
        <div className="flex items-center justify-between font-mono">
          <span className="text-sky-400 font-semibold">{activePoint.label} PROJECTION</span>
          <div className="flex items-center gap-3">
            <span className="text-rose-400">{activePoint.expectedDbz} dBZ</span>
            <span className="text-amber-400">{activePoint.expectedFlashRate} fl/m</span>
            <span className="text-emerald-400">{activePoint.convectiveProbPct}% Prob</span>
          </div>
        </div>
        <div className="text-slate-300 text-[11px] leading-snug">
          <span className="text-slate-500 font-mono uppercase mr-1">Hazard:</span>
          {activePoint.primaryHazard}
        </div>
        <div className="text-slate-400 text-[10.5px] leading-snug">
          <span className="text-slate-500 font-mono uppercase mr-1">Microphysics:</span>
          {activePoint.physicalProcess}
        </div>
      </div>
    </div>
  );
};
