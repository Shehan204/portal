import React, { useEffect, useRef, useState } from 'react';
import {
  ActiveSession,
  AttendanceRecord,
  ExperimentMode,
  SessionConfig,
  TEACHER_PASSWORD,
} from '../types/protocol';
import {
  endSession,
  getActiveSession,
  realtimeClient,
  startSession,
  verifyTeacherPassword,
} from '../utils/network';
import { renderQRToCanvas } from '../utils/qrGenerator';
import { createClientOpticalFrame } from '../utils/cryptoClient';
import {
  Lock,
  Play,
  Square,
  Maximize2,
  Minimize2,
  Download,
  Users,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Sliders,
  Clock,
  Sparkles,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

interface TeacherDashboardProps {
  onOpenStudentScanner: () => void;
  onOpenSecurityLab: () => void;
  onOpenCalibration: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  onOpenStudentScanner,
  onOpenSecurityLab,
  onOpenCalibration,
}) => {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('teacher_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Session State
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isStarting, setIsStarting] = useState<boolean>(false);

  // Config State
  const [mode, setMode] = useState<ExperimentMode>('MODE_C_AUTHENTICATED');
  const [qrRate, setQrRate] = useState<number>(8);
  const [durationMinutes, setDurationMinutes] = useState<number>(5);
  const [randomTiming, setRandomTiming] = useState<boolean>(false);
  const [frameChaining, setFrameChaining] = useState<boolean>(true);
  const [requiredFrames, setRequiredFrames] = useState<number>(4);
  const [timingJitterPercent, setTimingJitterPercent] = useState<number>(20);

  // Optical Display State
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [currentFramePayload, setCurrentFramePayload] = useState<string>('');
  const [framesGeneratedCount, setFramesGeneratedCount] = useState<number>(0);
  const [currentSeq, setCurrentSeq] = useState<number>(0);
  const [timeRemainingSec, setTimeRemainingSec] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const frameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const localSeqRef = useRef<number>(0);
  const localLastHashRef = useRef<string>('00000000');

  // Load active session
  useEffect(() => {
    loadSession();

    // Listen to real-time events
    const unsubUpdate = realtimeClient.on('attendance.updated', (data: { record: AttendanceRecord }) => {
      setSession((prev) => {
        if (!prev) return prev;
        const exists = prev.attendance.some((a) => a.studentName === data.record.studentName);
        if (exists) return prev;
        return {
          ...prev,
          attendance: [data.record, ...prev.attendance],
        };
      });
    });

    const unsubState = realtimeClient.on('session.state', (data: any) => {
      setSession((prev) => (prev ? { ...prev, ...data } : data));
    });

    const unsubEnded = realtimeClient.on('session.ended', () => {
      loadSession();
    });

    return () => {
      unsubUpdate();
      unsubState();
      unsubEnded();
    };
  }, []);

  const loadSession = async () => {
    setIsLoading(true);
    const active = await getActiveSession();
    if (active) {
      setSession(active);
      setMode(active.config.mode);
      setQrRate(active.config.qrRate);
      setDurationMinutes(active.config.durationMinutes);
      setRandomTiming(active.config.randomTiming);
      setFrameChaining(active.config.frameChaining);
      setRequiredFrames(active.config.requiredFrames);
      setTimingJitterPercent(active.config.timingJitterPercent || 20);
      localSeqRef.current = active.currentSeq || 0;
      setFramesGeneratedCount(active.framesGenerated || 0);
    }
    setIsLoading(false);
  };

  // Password submission
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const valid = await verifyTeacherPassword(passwordInput);
    if (valid) {
      setIsAuthenticated(true);
      sessionStorage.setItem('teacher_auth', 'true');
    } else {
      setAuthError('Invalid password. For this research PoC, use: research2026');
    }
  };

  // Start Session
  const handleStartSession = async () => {
    setIsStarting(true);
    const config: SessionConfig = {
      mode,
      qrRate,
      durationMinutes,
      randomTiming: mode === 'MODE_D_AUTH_RANDOM_TIMING' ? true : randomTiming,
      frameChaining,
      requiredFrames,
      timingJitterPercent,
    };

    const res = await startSession(TEACHER_PASSWORD, config);
    if (res.success && res.session) {
      setSession(res.session);
      localSeqRef.current = 0;
      localLastHashRef.current = '00000000';
      setFramesGeneratedCount(0);
    } else {
      alert(`Failed to start session: ${res.error}`);
    }
    setIsStarting(false);
  };

  // End Session
  const handleEndSession = async () => {
    if (!confirm('Are you sure you want to end this attendance session?')) return;
    await endSession(TEACHER_PASSWORD);
    if (frameTimerRef.current) {
      clearTimeout(frameTimerRef.current);
    }
    await loadSession();
  };

  // Session Time Remaining Countdown
  useEffect(() => {
    if (!session || session.status !== 'ACTIVE') {
      setTimeRemainingSec(0);
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000));
      setTimeRemainingSec(remaining);
      if (remaining === 0 && session.status === 'ACTIVE') {
        setSession((prev) => (prev ? { ...prev, status: 'EXPIRED' } : null));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session]);

  // Optical Signal Animation Loop
  useEffect(() => {
    if (!session || session.status !== 'ACTIVE') {
      if (frameTimerRef.current) clearTimeout(frameTimerRef.current);
      return;
    }

    let isRunning = true;

    const generateAndDrawNextFrame = async () => {
      if (!isRunning) return;

      let rawPayload = '';
      let generatedTotal = framesGeneratedCount;
      let generatedSeq = currentSeq;

      try {
        // Fetch new frame payload from backend
        const res = await fetch('/api/session/generate-frame', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          rawPayload = data.raw;
          generatedTotal = data.framesGenerated;
          generatedSeq = data.seq;
        }
      } catch {
        // Fallback for static hosts
      }

      if (!rawPayload && session) {
        localSeqRef.current += 1;
        const { raw, chainHash } = createClientOpticalFrame(
          session.id,
          session.nonce || 'local_nonce',
          session.secret || 'local_secret',
          localSeqRef.current,
          session.config,
          localLastHashRef.current
        );
        localLastHashRef.current = chainHash;
        rawPayload = raw;
        generatedSeq = localSeqRef.current;
        generatedTotal = localSeqRef.current;
      }

      if (rawPayload) {
        setCurrentFramePayload(rawPayload);
        setFramesGeneratedCount(generatedTotal);
        setCurrentSeq(generatedSeq);

        if (canvasRef.current) {
          try {
            await renderQRToCanvas(canvasRef.current, rawPayload, {
              errorCorrectionLevel: 'L',
              margin: 1,
              width: isFullscreen ? 600 : 360,
            });
          } catch {}
        }
      }

      // Calculate next frame interval with optional jitter
      const nominalInterval = 1000 / (session.config?.qrRate || 8);
      let nextInterval = nominalInterval;

      if (session.config?.mode === 'MODE_D_AUTH_RANDOM_TIMING' || session.config?.randomTiming) {
        const jitterRatio = (session.config.timingJitterPercent || 20) / 100;
        const delta = nominalInterval * jitterRatio;
        const randomShift = (Math.random() * 2 - 1) * delta;
        nextInterval = Math.max(30, Math.round(nominalInterval + randomShift));
      }

      frameTimerRef.current = setTimeout(generateAndDrawNextFrame, nextInterval);
    };

    generateAndDrawNextFrame();

    return () => {
      isRunning = false;
      if (frameTimerRef.current) clearTimeout(frameTimerRef.current);
    };
  }, [session?.id, session?.status, session?.config?.qrRate, session?.config?.mode, isFullscreen]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      fullscreenContainerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // If not authenticated, show password prompt
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-16 px-4">
        <div className="bg-[#151518] border border-white/10 p-8 relative overflow-hidden shadow-2xl">
          <div className="absolute -right-6 -bottom-6 text-9xl font-black text-white/5 pointer-events-none select-none">
            01
          </div>
          <div className="w-10 h-10 bg-white text-black flex items-center justify-center mb-6">
            <Lock className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/40 block mb-2">
            Security Gate &bull; Node Access
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-white mb-2">
            Teacher Console
          </h2>
          <p className="font-serif-italic text-sm text-white/60 mb-6 leading-relaxed">
            Enter the academic prototype credential to calibrate, broadcast, and synchronize temporal optical sequences.
          </p>

          <form onSubmit={handleAuthSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-white/70 mb-2">
                Authentication Key
              </label>
              <input
                id="teacher-password-input"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="research2026"
                className="w-full px-4 py-3 bg-[#0F0F11] border border-white/15 text-white placeholder:text-white/30 focus:outline-none focus:border-white font-mono text-sm"
              />
            </div>

            {authError && (
              <div className="p-3 bg-rose-950/50 border border-rose-500/40 text-xs text-rose-300 font-mono">
                {authError}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPasswordInput('research2026')}
                className="px-3.5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-xs font-mono font-bold tracking-wider uppercase transition-colors"
              >
                Auto-Fill
              </button>
              <button
                id="teacher-unlock-btn"
                type="submit"
                className="flex-1 py-3 bg-white hover:bg-zinc-200 text-black text-xs font-black tracking-[0.2em] uppercase transition-colors"
              >
                Authenticate
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const isSessionActive = session && session.status === 'ACTIVE';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      {/* Top Header with Bold Typography Archetype */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-white/10 mb-8 relative">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[10px] font-bold tracking-[0.35em] uppercase text-white/40">
              Module 01 // Broadcast Controller
            </span>
            <span
              className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 border ${
                isSessionActive
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40 animate-pulse'
                  : 'bg-white/5 text-white/50 border-white/10'
              }`}
            >
              STATE: {session ? session.status : 'INACTIVE'}
            </span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black tracking-[-0.04em] uppercase text-white leading-[0.9]">
            TEACHER <span className="text-stroke-subtle text-transparent">CONSOLE.</span>
          </h1>

          <div className="flex items-center gap-4 mt-3">
            <div className="w-12 h-[1px] bg-white/20"></div>
            <p className="font-serif-italic text-sm sm:text-base text-white/60">
              High-frequency dynamic optical broadcast engine for anti-replay temporal verification.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 relative z-10">
          <button
            id="student-scanner-link-btn"
            onClick={onOpenStudentScanner}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold tracking-[0.15em] uppercase bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all"
          >
            <span>Student Scanner</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          <a
            href="/api/metrics/export/csv"
            download="temporal_qr_research_metrics.csv"
            className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider bg-transparent hover:bg-white/5 text-white/80 border border-white/15 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </a>

          <a
            href="/api/metrics/export/json"
            download="temporal_qr_research_metrics.json"
            className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider bg-transparent hover:bg-white/5 text-white/80 border border-white/15 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>JSON</span>
          </a>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Optical Display Area (7 cols on lg) */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div
            ref={fullscreenContainerRef}
            className={`w-full bg-[#151518] text-white p-6 sm:p-8 flex flex-col items-center justify-between border border-white/10 shadow-2xl relative transition-all ${
              isFullscreen ? 'fixed inset-0 z-50 p-12 justify-center bg-[#09090B]' : 'min-h-[560px]'
            }`}
          >
            {/* Header info bar */}
            <div className="w-full flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSessionActive ? 'bg-emerald-400 animate-ping' : 'bg-white/20'
                  }`}
                />
                <span className="font-mono text-xs text-white/80 font-bold tracking-widest uppercase">
                  {session?.config?.mode || mode}
                </span>
              </div>
              <div className="flex items-center gap-5 text-xs font-mono">
                <span className="text-white/60">
                  RATE: <strong className="text-white font-bold">{session?.config?.qrRate || qrRate} QR/s</strong>
                </span>
                <span className="text-white/60">
                  CLOCK: <strong className="text-amber-400 font-bold">{formatTime(timeRemainingSec)}</strong>
                </span>
                <button
                  id="fullscreen-toggle-btn"
                  onClick={toggleFullscreen}
                  className="p-1.5 bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/10 transition-colors"
                  title="Fullscreen Projector Mode"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Central Optical QR Square Canvas */}
            <div className="my-6 flex flex-col items-center justify-center">
              <div className="p-4 bg-white shadow-2xl border-4 border-white flex items-center justify-center">
                <canvas
                  id="dynamic-optical-canvas"
                  ref={canvasRef}
                  width={isFullscreen ? 520 : 320}
                  height={isFullscreen ? 520 : 320}
                  className="block"
                />
              </div>

              {!isSessionActive && (
                <div className="mt-4 text-center">
                  <span className="inline-block px-4 py-1.5 bg-black/60 border border-white/10 text-white/50 text-xs font-mono uppercase tracking-wider">
                    STANDBY // Configure settings & trigger "START SESSION"
                  </span>
                </div>
              )}
            </div>

            {/* Optical Signal Telemetry Footer */}
            <div className="w-full grid grid-cols-3 gap-3 pt-4 border-t border-white/10 text-center font-mono">
              <div className="bg-[#0F0F11] p-3 border border-white/10">
                <div className="text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                  Sequence Index
                </div>
                <div className="text-xl font-black text-white mt-1">#{currentSeq}</div>
              </div>
              <div className="bg-[#0F0F11] p-3 border border-white/10">
                <div className="text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                  Frames Emitted
                </div>
                <div className="text-xl font-black text-emerald-400 mt-1">
                  {framesGeneratedCount.toLocaleString()}
                </div>
              </div>
              <div className="bg-[#0F0F11] p-3 border border-white/10">
                <div className="text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                  Students Logged
                </div>
                <div className="text-xl font-black text-white mt-1">
                  {session?.attendance?.length || 0}
                </div>
              </div>
            </div>
          </div>

          {/* Raw Payload Diagnostic Stream */}
          <div className="w-full mt-4 bg-[#151518] text-white/80 p-4 border border-white/10 text-xs font-mono overflow-x-auto">
            <span className="text-white/40 font-bold uppercase tracking-[0.25em] text-[9px] block mb-1">
              Live Serialized Optical Payload
            </span>
            <code className="text-emerald-400 break-all select-all font-mono text-[11px]">
              {currentFramePayload || 'Waiting for session start...'}
            </code>
          </div>
        </div>

        {/* Right Column: Parameters & Live Attendance Feed (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Session Controller Panel */}
          <div className="bg-[#151518] border border-white/10 p-6 shadow-sm relative">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-white" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">
                  Protocol Controls
                </h2>
              </div>
              <button
                onClick={loadSession}
                className="p-1.5 text-white/40 hover:text-white transition-colors"
                title="Refresh state"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Protocol Mode */}
              <div>
                <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.25em] mb-2">
                  Experiment Mode
                </label>
                <select
                  id="mode-select"
                  disabled={isSessionActive}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ExperimentMode)}
                  className="w-full px-3 py-2.5 text-xs bg-[#0F0F11] border border-white/15 text-white font-mono focus:border-white focus:outline-none disabled:opacity-50"
                >
                  <option value="MODE_A_STATIC">Mode A: Static QR (Baseline)</option>
                  <option value="MODE_B_DYNAMIC">Mode B: Dynamic QR (Unauthenticated)</option>
                  <option value="MODE_C_AUTHENTICATED">
                    Mode C: Dynamic Authenticated QR (HMAC-SHA256)
                  </option>
                  <option value="MODE_D_AUTH_RANDOM_TIMING">
                    Mode D: Dynamic Authenticated + Random Jitter
                  </option>
                </select>
                <p className="text-[11px] text-white/40 font-serif-italic mt-1.5">
                  {mode === 'MODE_A_STATIC' && 'Static baseline: Invariant single token comparison.'}
                  {mode === 'MODE_B_DYNAMIC' && 'Temporal sequence without cryptographic tags.'}
                  {mode === 'MODE_C_AUTHENTICATED' &&
                    'HMAC-SHA256, frame hash chaining, monotonic seq validation.'}
                  {mode === 'MODE_D_AUTH_RANDOM_TIMING' &&
                    'Cryptographic temporal sequence with randomized interval jitter (±20%).'}
                </p>
              </div>

              {/* QR Optical Rate */}
              <div>
                <div className="flex justify-between text-[10px] font-bold text-white/50 uppercase tracking-[0.25em] mb-2">
                  <span>Emission Frequency</span>
                  <span className="text-white font-mono font-bold">{qrRate} QR / SEC</span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                  {[2, 4, 6, 8, 10, 12, 15, 20].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      disabled={isSessionActive}
                      onClick={() => setQrRate(rate)}
                      className={`py-2 text-xs font-mono font-bold border transition-all ${
                        qrRate === rate
                          ? 'bg-white text-black border-white font-black'
                          : 'bg-[#0F0F11] text-white/70 border-white/10 hover:border-white/30'
                      } disabled:opacity-40`}
                    >
                      {rate}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration & Required Frames */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.25em] mb-1.5">
                    Session Span
                  </label>
                  <select
                    disabled={isSessionActive}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-[#0F0F11] border border-white/15 text-white font-mono disabled:opacity-50"
                  >
                    <option value={1}>1 Minute</option>
                    <option value={3}>3 Minutes</option>
                    <option value={5}>5 Minutes</option>
                    <option value={10}>10 Minutes</option>
                    <option value={30}>30 Minutes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.25em] mb-1.5">
                    Frame Quorum
                  </label>
                  <select
                    disabled={isSessionActive}
                    value={requiredFrames}
                    onChange={(e) => setRequiredFrames(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-[#0F0F11] border border-white/15 text-white font-mono disabled:opacity-50"
                  >
                    <option value={1}>1 Frame (Minimal)</option>
                    <option value={3}>3 Frames</option>
                    <option value={4}>4 Frames (Optimal)</option>
                    <option value={5}>5 Frames</option>
                    <option value={8}>8 Frames</option>
                  </select>
                </div>
              </div>

              {/* Security Toggles */}
              <div className="pt-3 border-t border-white/10 space-y-2.5">
                <label className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-white/70 cursor-pointer">
                  <span>Recursive Hash Chaining</span>
                  <input
                    type="checkbox"
                    disabled={isSessionActive}
                    checked={frameChaining}
                    onChange={(e) => setFrameChaining(e.target.checked)}
                    className="w-4 h-4 accent-white rounded-none cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-white/70 cursor-pointer">
                  <span>Timing Jitter (±20%)</span>
                  <input
                    type="checkbox"
                    disabled={isSessionActive}
                    checked={mode === 'MODE_D_AUTH_RANDOM_TIMING' || randomTiming}
                    onChange={(e) => setRandomTiming(e.target.checked)}
                    className="w-4 h-4 accent-white rounded-none cursor-pointer"
                  />
                </label>
              </div>

              {/* Action Buttons */}
              <div className="pt-3">
                {isSessionActive ? (
                  <button
                    id="end-session-btn"
                    onClick={handleEndSession}
                    className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-[0.2em] text-xs transition-colors flex items-center justify-center gap-2"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>TERMINATE SESSION</span>
                  </button>
                ) : (
                  <button
                    id="start-session-btn"
                    onClick={handleStartSession}
                    disabled={isStarting}
                    className="w-full py-3.5 bg-white hover:bg-zinc-200 text-black font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{isStarting ? 'INITIALIZING...' : 'START ATTENDANCE BROADCAST'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Real-time Attendance Feed */}
          <div className="bg-[#151518] border border-white/10 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-white" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">
                  Live Attendance Feed
                </h2>
              </div>
              <span className="text-[10px] font-black font-mono px-2.5 py-0.5 bg-emerald-950/60 text-emerald-300 border border-emerald-500/40">
                {session?.attendance?.length || 0} PRESENT
              </span>
            </div>

            {session?.attendance && session.attendance.length > 0 ? (
              <div className="divide-y divide-white/5 max-h-64 overflow-y-auto pr-1">
                {session.attendance.map((rec) => (
                  <div key={rec.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="font-bold text-white font-mono">{rec.studentName}</span>
                    </div>
                    <div className="text-right text-white/50 font-mono text-[11px]">
                      <div>{new Date(rec.timestamp).toLocaleTimeString()}</div>
                      <div className="text-white/40">
                        {rec.framesCaptured} frames &bull; {rec.verificationLatencyMs}ms
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-white/40 font-serif-italic">
                No students verified yet for this session.
                <br />
                <span className="font-sans text-[11px] font-mono text-white/30 uppercase tracking-widest mt-1 block">
                  Awaiting optical decode stream...
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
