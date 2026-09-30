import React, { useState } from 'react';
import {
  BrainCircuit,
  RefreshCw,
  Sliders,
  Send,
  ChevronRight,
  ChevronLeft,
  ShieldAlert,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import type {
  ObservationBundle,
  AiNowcastResult,
  PerturbationParams,
} from '../types/nowcast';
import { NowcastEvolutionChart } from './NowcastEvolutionChart';

interface AiNowcastWorkstationDockProps {
  bundle: ObservationBundle | null;
  nowcast: AiNowcastResult | null;
  isLoadingNowcast: boolean;
  onRunNowcast: (perturbation?: PerturbationParams) => void;
  selectedNowcastMinute: number;
  onSelectNowcastMinute: (min: number) => void;
  perturbation: PerturbationParams;
  onUpdatePerturbation: (p: PerturbationParams) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export const AiNowcastWorkstationDock: React.FC<
  AiNowcastWorkstationDockProps
> = ({
  bundle,
  nowcast,
  isLoadingNowcast,
  onRunNowcast,
  selectedNowcastMinute,
  onSelectNowcastMinute,
  perturbation,
  onUpdatePerturbation,
  collapsed: externalCollapsed,
  onToggleCollapsed,
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'FUSION' | 'LAB'>('FUSION');
  const [question, setQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isAskingAi, setIsAskingAi] = useState(false);

  const isCollapsed =
    externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;

  const handleToggleCollapse = () => {
    if (onToggleCollapsed) {
      onToggleCollapsed();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  };

  const handleAskQuestion = async (qText?: string) => {
    const queryToUse = (qText ?? question).trim();
    if (!queryToUse || !bundle) return;
    setIsAskingAi(true);
    try {
      const res = await fetch('/api/ai-forecaster-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: queryToUse,
          bundle,
          nowcast,
        }),
      });
      const data = await res.json();
      if (data.answer) {
        setAiAnswer(data.answer);
      }
      if (!qText) setQuestion('');
    } catch (e) {
      console.error(e);
    } finally {
      setIsAskingAi(false);
    }
  };

  if (isCollapsed) {
    return (
      <div className="absolute top-3 right-3 z-20 pointer-events-auto">
        <button
          onClick={handleToggleCollapse}
          className="bg-[#0B0E17]/95 backdrop-blur-md border border-slate-800 hover:border-cyan-500/60 text-slate-200 px-3 py-2 rounded-md shadow-xl flex items-center gap-2 text-xs font-mono transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
          <BrainCircuit className="w-3.5 h-3.5 text-cyan-400" />
          <span>AIML Nowcast Engine</span>
        </button>
      </div>
    );
  }

  const alertColors: Record<
    AiNowcastResult['alertLevel'],
    { bg: string; border: string; text: string; glyph: string }
  > = {
    NORMAL: {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/40',
      text: 'text-emerald-300',
      glyph: '●',
    },
    WATCH: {
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/40',
      text: 'text-cyan-300',
      glyph: '◆',
    },
    ADVISORY: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/40',
      text: 'text-amber-300',
      glyph: '▲',
    },
    SEVERE_WARNING: {
      bg: 'bg-rose-500/15',
      border: 'border-rose-500/60',
      text: 'text-rose-300',
      glyph: '▲',
    },
    EXTREME_CRITICAL: {
      bg: 'bg-fuchsia-500/20',
      border: 'border-fuchsia-400/80',
      text: 'text-fuchsia-200',
      glyph: '✖',
    },
  };

  const currentAlertStyle = nowcast
    ? alertColors[nowcast.alertLevel] || alertColors.WATCH
    : alertColors.WATCH;

  return (
    <aside className="w-[365px] xl:w-[385px] shrink-0 h-full z-20 pointer-events-auto flex flex-col bg-[#0B0E17] border-l border-slate-800/90 select-none overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/90 flex items-center justify-between bg-[#07090E]">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <BrainCircuit className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div>
            <h2 className="font-display text-xs font-semibold tracking-wide text-slate-100">
              AIML Convective Nowcast Engine
            </h2>
            <p className="text-[10.5px] text-slate-400">
              Multi-Sensor Data Fusion · 0–120 Min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onRunNowcast(perturbation)}
            disabled={isLoadingNowcast || !bundle}
            className="px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/50 text-cyan-200 text-[10.5px] font-mono flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
            title="Re-run AIML Multi-Sensor Fusion"
          >
            <RefreshCw
              className={`w-3 h-3 ${isLoadingNowcast ? 'animate-spin' : ''}`}
            />
            <span>{isLoadingNowcast ? 'Fusing...' : 'Fuse Now'}</span>
          </button>
          <button
            onClick={handleToggleCollapse}
            className="p-1.5 rounded hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title="Collapse AI Workstation Dock"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="grid grid-cols-2 border-b border-slate-800/90 bg-[#07090E] text-[11px] font-medium">
        <button
          onClick={() => setActiveSubTab('FUSION')}
          className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
            activeSubTab === 'FUSION'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Nowcast & Fusion</span>
        </button>
        <button
          onClick={() => setActiveSubTab('LAB')}
          className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
            activeSubTab === 'LAB'
              ? 'border-amber-400 text-amber-300 bg-amber-500/5 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Perturbation & AI Lab</span>
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {isLoadingNowcast && !nowcast ? (
          <div className="space-y-2.5 py-8 text-center">
            <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
            <div className="text-xs font-mono text-slate-200">
              Executing AIML Multi-Sensor Convective Fusion...
            </div>
            <div className="text-[10.5px] text-slate-500 max-w-xs mx-auto">
              Assimilating Doppler Radar Z/Zdr/VIL, GOES-IR Tb, GLM Flash Rate & NWP Sounding
            </div>
          </div>
        ) : nowcast ? (
          <>
            {/* Alert Status Banner & Storm Mode */}
            <div
              className={`p-3 rounded-md border ${currentAlertStyle.bg} ${currentAlertStyle.border} flex items-center justify-between`}
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className={`w-4 h-4 shrink-0 ${currentAlertStyle.text}`} />
                  <span
                    className={`font-mono text-xs font-bold tracking-wider ${currentAlertStyle.text}`}
                  >
                    {currentAlertStyle.glyph} {nowcast.alertLevel.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-xs text-slate-100 font-medium mt-0.5 truncate">
                  {nowcast.stormMode}
                </div>
              </div>
              <div className="text-right font-mono shrink-0">
                <span className="text-[9px] text-slate-400 block">CONFIDENCE</span>
                <span className="text-base font-bold text-slate-100">
                  {nowcast.confidenceScorePct}
                </span>
                <span className="text-[10px] text-slate-400 ml-0.5">%</span>
              </div>
            </div>

            {/* 4 Key Quantitative Nowcast Metrics */}
            <div className="grid grid-cols-4 gap-1.5 font-mono text-center">
              <div className="bg-[#07090E]/90 border border-slate-800/90 rounded p-2">
                <span className="text-[9px] text-slate-500 block">INIT PROB</span>
                <span className="text-sm font-bold text-cyan-400">
                  {nowcast.convectiveInitiationProbPct}
                </span>
                <span className="text-[9.5px] text-slate-400 ml-0.5">%</span>
              </div>
              <div className="bg-[#07090E]/90 border border-slate-800/90 rounded p-2">
                <span className="text-[9px] text-slate-500 block">LTG JUMP</span>
                <span className="text-sm font-bold text-amber-400">
                  {nowcast.lightningJumpProbPct}
                </span>
                <span className="text-[9.5px] text-slate-400 ml-0.5">%</span>
              </div>
              <div className="bg-[#07090E]/90 border border-slate-800/90 rounded p-2">
                <span className="text-[9px] text-slate-500 block">PEAK FL/M</span>
                <span className="text-sm font-bold text-amber-300">
                  {nowcast.projectedPeakFlashRatePerMin}
                </span>
              </div>
              <div className="bg-[#07090E]/90 border border-slate-800/90 rounded p-2">
                <span className="text-[9px] text-slate-500 block">MAX Z</span>
                <span className="text-sm font-bold text-rose-400">
                  {nowcast.projectedMaxDbz}
                </span>
                <span className="text-[9px] text-slate-400 ml-0.5">dBZ</span>
              </div>
            </div>

            {/* 0-120m Nowcast Evolution SVG Chart */}
            <NowcastEvolutionChart
              projections={nowcast.timelineProjections}
              selectedMinuteOffset={selectedNowcastMinute}
              onSelectMinuteOffset={onSelectNowcastMinute}
            />

            {activeSubTab === 'FUSION' ? (
              <>
                {/* AI Synthesis & Physical Reasoning */}
                <div className="bg-[#07090E]/90 border border-slate-800/90 rounded-md p-3 space-y-1.5">
                  <div className="text-[11px] font-semibold text-cyan-400">
                    AI Mesoscale Synthesis
                  </div>
                  <p className="text-xs text-slate-100 font-medium leading-relaxed">
                    {nowcast.headlineSummary}
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {nowcast.synopticAndMesoscaleAnalysis}
                  </p>
                </div>

                {/* Multi-Sensor Attribution Weights */}
                <div className="bg-[#07090E]/90 border border-slate-800/90 rounded-md p-3">
                  <div className="flex items-center justify-between text-[11px] mb-2.5">
                    <span className="font-medium text-slate-200">Multi-Sensor Attention Weights</span>
                    <span className="font-mono text-[10px] text-slate-500">Fusion Share</span>
                  </div>

                  <div className="space-y-2 font-mono text-[10.5px]">
                    {[
                      {
                        label: 'Doppler Radar Network (Z / VIL / Zdr)',
                        val: nowcast.sensorAttributionWeights.radar,
                        color: 'bg-cyan-400',
                        sig: nowcast.multiSensorCrossCorrelation.radarSignature,
                      },
                      {
                        label: 'GLM / VLF Lightning Telemetry',
                        val: nowcast.sensorAttributionWeights.lightning,
                        color: 'bg-amber-400',
                        sig: nowcast.multiSensorCrossCorrelation.lightningGlmSignature,
                      },
                      {
                        label: 'GOES-IR Cloud-Top Brightness Tb',
                        val: nowcast.sensorAttributionWeights.satellite,
                        color: 'bg-teal-400',
                        sig: nowcast.multiSensorCrossCorrelation.satelliteIrSignature,
                      },
                      {
                        label: 'Open-Meteo NWP Sounding & Shear',
                        val: nowcast.sensorAttributionWeights.nwpModel,
                        color: 'bg-emerald-400',
                        sig: nowcast.multiSensorCrossCorrelation.nwpThermodynamicState,
                      },
                    ].map((item) => (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between text-slate-300">
                          <span>{item.label}</span>
                          <span className="font-bold text-slate-100">{item.val}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-900 rounded-xs overflow-hidden">
                          <div
                            className={`h-full ${item.color}`}
                            style={{ width: `${Math.min(100, item.val)}%` }}
                          />
                        </div>
                        <p className="text-[10.5px] font-sans text-slate-400 leading-snug pt-0.5 pb-1">
                          {item.sig}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Operational Sector Directives */}
                <div className="bg-[#07090E]/90 border border-slate-800/90 rounded-md p-3 space-y-2">
                  <div className="text-[11px] font-medium text-slate-200">
                    Operational Sector Directives
                  </div>
                  {nowcast.operationalDirectives.map((dir, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded bg-[#0B0E17] border border-slate-800/80 text-[11px]"
                    >
                      <div className="flex items-center justify-between font-mono mb-1">
                        <span className="text-cyan-300 font-semibold text-[10.5px]">
                          {dir.sector.replace('_', ' ')}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${
                            dir.priority === 'HIGH'
                              ? 'text-rose-400'
                              : 'text-amber-300'
                          }`}
                        >
                          {dir.priority === 'HIGH' ? '● HIGH' : '▲ MEDIUM'}
                        </span>
                      </div>
                      <p className="text-slate-300 leading-snug">{dir.directive}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* PERTURBATION SIMULATOR & INTERACTIVE AI METEOROLOGIST LAB */
              <div className="space-y-3">
                {/* Thermodynamic Perturbation Experiment Box */}
                <div className="bg-[#07090E]/90 border border-slate-800/90 rounded-md p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-amber-300 block">
                        Boundary-Layer Perturbation Simulator
                      </span>
                      <span className="text-[10.5px] text-slate-400">
                        Test sensitivity of AI Nowcast to thermodynamic forcing
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const reset = {
                          deltaTempC: 0,
                          deltaDewpointC: 0,
                          deltaShearKt: 0,
                        };
                        onUpdatePerturbation(reset);
                        onRunNowcast(reset);
                      }}
                      className="text-[10.5px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                      title="Reset Perturbations"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </button>
                  </div>

                  <div className="space-y-2.5 font-mono text-[11px]">
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Δ Surface Temperature</span>
                        <span className="text-rose-400 font-bold">
                          {perturbation.deltaTempC >= 0
                            ? `+${perturbation.deltaTempC}`
                            : perturbation.deltaTempC}{' '}
                          °C
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-4}
                        max={6}
                        step={0.5}
                        value={perturbation.deltaTempC}
                        onChange={(e) =>
                          onUpdatePerturbation({
                            ...perturbation,
                            deltaTempC: Number(e.target.value),
                          })
                        }
                        className="w-full accent-rose-500 cursor-pointer h-1.5"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Δ Boundary-Layer Dewpoint</span>
                        <span className="text-emerald-400 font-bold">
                          {perturbation.deltaDewpointC >= 0
                            ? `+${perturbation.deltaDewpointC}`
                            : perturbation.deltaDewpointC}{' '}
                          °C
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-4}
                        max={6}
                        step={0.5}
                        value={perturbation.deltaDewpointC}
                        onChange={(e) =>
                          onUpdatePerturbation({
                            ...perturbation,
                            deltaDewpointC: Number(e.target.value),
                          })
                        }
                        className="w-full accent-emerald-500 cursor-pointer h-1.5"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Δ 0–6 km Bulk Wind Shear</span>
                        <span className="text-cyan-400 font-bold">
                          {perturbation.deltaShearKt >= 0
                            ? `+${perturbation.deltaShearKt}`
                            : perturbation.deltaShearKt}{' '}
                          kt
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-15}
                        max={30}
                        step={5}
                        value={perturbation.deltaShearKt}
                        onChange={(e) =>
                          onUpdatePerturbation({
                            ...perturbation,
                            deltaShearKt: Number(e.target.value),
                          })
                        }
                        className="w-full accent-cyan-400 cursor-pointer h-1.5"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => onRunNowcast(perturbation)}
                    disabled={isLoadingNowcast}
                    className="w-full py-2 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/50 text-amber-200 font-mono text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isLoadingNowcast
                      ? 'Running Perturbed AI Fusion...'
                      : 'Run Perturbed AIML Nowcast'}
                  </button>
                </div>

                {/* Interactive AI Meteorologist Diagnostic Query */}
                <div className="bg-[#07090E]/90 border border-slate-800/90 rounded-md p-3 space-y-2.5">
                  <div className="text-xs font-semibold text-cyan-400">
                    Cross-Sensor AI Diagnostic Query
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Explain lightning jump & graupel charging risk',
                      'Assess radar beam altitude & low-level coverage',
                      'Compare hail vs. microburst wind potential',
                    ].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => handleAskQuestion(preset)}
                        disabled={isAskingAi}
                        className="text-[10.5px] px-2.5 py-1 rounded bg-[#0B0E17] hover:bg-slate-800 border border-slate-800 text-slate-300 text-left transition-colors cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAskQuestion();
                      }}
                      placeholder="Ask AI about radar, sounding, or lightning..."
                      className="flex-1 bg-[#0B0E17] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      onClick={() => handleAskQuestion()}
                      disabled={isAskingAi || !question.trim()}
                      className="p-2 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:opacity-40 cursor-pointer transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isAskingAi && (
                    <div className="text-[11px] font-mono text-cyan-400 animate-pulse pt-1">
                      Analyzing live radar, satellite & sounding telemetry...
                    </div>
                  )}

                  {aiAnswer && (
                    <div className="p-2.5 rounded bg-[#0B0E17] border border-cyan-500/30 text-[11.5px] text-slate-200 leading-relaxed">
                      {aiAnswer}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
};
