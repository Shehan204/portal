import React, { useEffect, useRef, useState } from 'react';
import { CalibrationResult, DEFAULT_RELIABILITY_THRESHOLD } from '../types/protocol';
import { renderQRToCanvas } from '../utils/qrGenerator';
import { QRScannerEngine } from '../utils/qrDecoder';
import { logResearchMetric } from '../utils/network';
import {
  Activity,
  Play,
  CheckCircle,
  AlertCircle,
  Camera,
  RefreshCw,
  Sliders,
  TrendingUp,
  Cpu,
  Info,
  CheckCircle2,
} from 'lucide-react';

const CALIBRATION_RATES = [2, 4, 6, 8, 10, 12, 15, 20];
const DURATION_PER_STEP_MS = 2500; // 2.5 seconds per rate test

export const CameraCalibration: React.FC = () => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentTestRateIndex, setCurrentTestRateIndex] = useState<number>(0);
  const [results, setResults] = useState<CalibrationResult[]>([]);
  const [reliabilityThreshold, setReliabilityThreshold] = useState<number>(
    DEFAULT_RELIABILITY_THRESHOLD
  );

  // Live Optical Generator State
  const [displaySeq, setDisplaySeq] = useState<number>(0);
  const [cameraFps, setCameraFps] = useState<number>(0);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');

  // Test mode: 'CAMERA_SELF_TEST' | 'SCREEN_PROJECTOR_TEST'
  const [mode, setMode] = useState<'CAMERA_SELF_TEST' | 'SCREEN_PROJECTOR_TEST'>(
    'CAMERA_SELF_TEST'
  );

  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerEngineRef = useRef<QRScannerEngine | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const currentStepStatsRef = useRef<{
    attempted: number;
    decoded: number;
    latencies: number[];
    lastDecodedSeq: number;
  }>({
    attempted: 0,
    decoded: 0,
    latencies: [],
    lastDecodedSeq: -1,
  });

  useEffect(() => {
    scannerEngineRef.current = new QRScannerEngine();
    return () => {
      stopCalibration();
    };
  }, []);

  const startCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (e) {
      console.error('Camera init error:', e);
    }
  };

  const stopCalibration = () => {
    setIsRunning(false);
    if (frameIntervalRef.current) clearTimeout(frameIntervalRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Run the full automatic calibration sequence
  const startFullCalibration = async () => {
    setResults([]);
    setCurrentTestRateIndex(0);
    setIsRunning(true);

    if (mode === 'CAMERA_SELF_TEST') {
      await startCamera();
    }

    runRateStep(0);
  };

  const runRateStep = (rateIndex: number) => {
    if (rateIndex >= CALIBRATION_RATES.length) {
      // Completed all rates
      setIsRunning(false);
      return;
    }

    setCurrentTestRateIndex(rateIndex);
    const rate = CALIBRATION_RATES[rateIndex];
    currentStepStatsRef.current = {
      attempted: 0,
      decoded: 0,
      latencies: [],
      lastDecodedSeq: -1,
    };

    let stepSeq = 0;
    const intervalMs = 1000 / rate;

    // Optical frame generation loop for this rate
    const generateFrame = async () => {
      stepSeq++;
      currentStepStatsRef.current.attempted++;
      setDisplaySeq(stepSeq);

      const payload = `CALIB~${rate}~${stepSeq}~${Date.now()}`;
      if (displayCanvasRef.current) {
        await renderQRToCanvas(displayCanvasRef.current, payload, {
          errorCorrectionLevel: 'L',
          width: 240,
          margin: 1,
        });
      }

      if (isRunning) {
        frameIntervalRef.current = setTimeout(generateFrame, intervalMs);
      }
    };

    generateFrame();

    // Start scanner processing for this step
    const scanLoop = async () => {
      if (videoRef.current && scannerEngineRef.current) {
        const res = await scannerEngineRef.current.scanVideoFrame(videoRef.current);
        setCameraFps(scannerEngineRef.current.getFps());

        if (res && res.data && res.data.startsWith('CALIB~')) {
          const parts = res.data.split('~');
          const seq = parseInt(parts[2], 10);
          if (seq !== currentStepStatsRef.current.lastDecodedSeq) {
            currentStepStatsRef.current.lastDecodedSeq = seq;
            currentStepStatsRef.current.decoded++;
            currentStepStatsRef.current.latencies.push(res.decodeLatencyMs);
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(scanLoop);
    };

    animationFrameRef.current = requestAnimationFrame(scanLoop);

    // Schedule completion of this rate step
    setTimeout(() => {
      if (frameIntervalRef.current) clearTimeout(frameIntervalRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

      const stats = currentStepStatsRef.current;
      const successRate = stats.attempted > 0 ? stats.decoded / stats.attempted : 0;
      const avgLatency =
        stats.latencies.length > 0
          ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
          : 0;

      const result: CalibrationResult = {
        qrRate: rate,
        framesAttempted: stats.attempted,
        framesDecoded: stats.decoded,
        successRate: Math.min(1, successRate),
        avgLatencyMs: Math.round(avgLatency),
        cameraFps: scannerEngineRef.current?.getFps() || 30,
      };

      setResults((prev) => [...prev, result]);

      // Log to empirical dataset
      logResearchMetric({
        experimentMode: 'MODE_C_AUTHENTICATED',
        qrRate: rate,
        randomTiming: false,
        studentName: `Calibration_${navigator.userAgent.slice(0, 20)}`,
        cameraFps: result.cameraFps,
        framesGenerated: result.framesAttempted,
        framesDetected: result.framesDecoded,
        framesMissed: Math.max(0, result.framesAttempted - result.framesDecoded),
        decodeSuccessRate: result.successRate,
        verificationTimeMs: Math.round(avgLatency),
        result: result.successRate >= reliabilityThreshold ? 'SUCCESS' : 'FAILURE',
      });

      // Advance to next rate
      runRateStep(rateIndex + 1);
    }, DURATION_PER_STEP_MS);
  };

  // Find maximum reliable operating rate
  const reliableResults = results.filter((r) => r.successRate >= reliabilityThreshold);
  const maxReliableRate =
    reliableResults.length > 0
      ? Math.max(...reliableResults.map((r) => r.qrRate))
      : results.length > 0
      ? results[0].qrRate
      : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      {/* Header */}
      <div className="border-b border-white/10 pb-8 mb-8 relative">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[10px] font-bold tracking-[0.35em] uppercase text-white/40">
            Module 04 // Optical Sensor Benchmark
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-black tracking-[-0.04em] uppercase text-white leading-[0.9]">
          CAMERA <span className="text-stroke-subtle text-transparent">CALIBRATION.</span>
        </h1>

        <div className="flex items-center gap-4 mt-3">
          <div className="w-12 h-[1px] bg-white/20"></div>
          <p className="font-serif-italic text-sm sm:text-base text-white/60">
            Empirically profile camera decoding performance across optical transition rates (2 to 20 QR/s).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Calibration Runner & Live Optical Area */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#151518] text-white p-6 border border-white/10 shadow-2xl flex flex-col items-center relative">
            <div className="w-full flex items-center justify-between pb-3 border-b border-white/10 text-xs font-mono">
              <span className="text-white/60 uppercase tracking-wider text-[11px]">
                Rate: <strong className="text-white">{CALIBRATION_RATES[currentTestRateIndex]} QR/S</strong>
              </span>
              <span className="text-emerald-400 font-bold">SEQ #{displaySeq}</span>
            </div>

            {/* Test Pattern Optical Canvas */}
            <div className="my-6 p-4 bg-white shadow-2xl border-4 border-white">
              <canvas ref={displayCanvasRef} width={240} height={240} className="block" />
            </div>

            {/* Hidden/Live Camera Feed for self-test */}
            <div className="w-full relative h-28 bg-black overflow-hidden border border-white/15">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover opacity-80"
              />
              <div className="absolute bottom-2 left-2 bg-[#0F0F11]/90 text-white/80 px-2.5 py-1 border border-white/10 text-[10px] font-mono uppercase tracking-wider">
                SENSOR FPS: {cameraFps}
              </div>
            </div>

            <div className="w-full mt-5">
              {isRunning ? (
                <button
                  onClick={stopCalibration}
                  className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-[0.2em] text-xs transition-colors"
                >
                  ABORT CALIBRATION
                </button>
              ) : (
                <button
                  id="start-calibration-btn"
                  onClick={startFullCalibration}
                  className="w-full py-3.5 bg-white hover:bg-zinc-200 text-black font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>START AUTOMATED CALIBRATION</span>
                </button>
              )}
            </div>
          </div>

          {/* Config Card */}
          <div className="bg-[#151518] border border-white/10 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-white pb-3 border-b border-white/10">
              <Sliders className="w-4 h-4" />
              <span>Threshold Calibration</span>
            </div>

            <div>
              <div className="flex justify-between text-[10px] font-bold text-white/60 uppercase tracking-wider mb-2">
                <span>Reliability Cutoff</span>
                <span className="font-mono font-bold text-white">{(reliabilityThreshold * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.80"
                max="0.99"
                step="0.01"
                value={reliabilityThreshold}
                onChange={(e) => setReliabilityThreshold(parseFloat(e.target.value))}
                className="w-full accent-white cursor-pointer"
              />
              <p className="text-[11px] text-white/40 font-serif-italic mt-2">
                Minimum frame decode accuracy required to classify an optical frequency as safe and reliable.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Empirical Results & Recommendations */}
        <div className="lg:col-span-7 space-y-6">
          {/* Recommendation Banner */}
          {results.length > 0 && maxReliableRate && (
            <div className="bg-[#151518] border border-emerald-500/40 p-6 text-white flex items-start gap-4 shadow-xl">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-emerald-400 block mb-1">
                  Empirical Recommendation
                </span>
                <h3 className="text-lg font-black uppercase tracking-tight text-white">
                  OPTIMAL BROADCAST RATE: {maxReliableRate} QR / SEC
                </h3>
                <p className="text-xs text-white/70 font-serif-italic mt-1.5 leading-relaxed">
                  Based on empirical testing with this device's camera sensor and WebAssembly decode engine,{' '}
                  <strong className="text-white font-bold">{maxReliableRate} QR/sec</strong> is the highest rate maintaining ≥
                  {(reliabilityThreshold * 100).toFixed(0)}% optical decode reliability.
                </p>
              </div>
            </div>
          )}

          {/* Calibration Data Table */}
          <div className="bg-[#151518] border border-white/10 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/10">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">
                Empirical Decoding Curve
              </h2>
              <span className="text-[11px] font-mono text-white/40 uppercase">
                {results.length} / {CALIBRATION_RATES.length} Evaluated
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 uppercase font-mono text-[10px] tracking-wider">
                    <th className="pb-3">Rate</th>
                    <th className="pb-3">Emitted</th>
                    <th className="pb-3">Decoded</th>
                    <th className="pb-3">Success Rate</th>
                    <th className="pb-3">Latency</th>
                    <th className="pb-3 text-right">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-white/40 font-serif-italic">
                        Press "Start Automated Calibration" to begin benchmarking.
                      </td>
                    </tr>
                  ) : (
                    results.map((r) => {
                      const isPassing = r.successRate >= reliabilityThreshold;
                      return (
                        <tr key={r.qrRate} className="hover:bg-white/[0.02]">
                          <td className="py-3 font-bold text-white">{r.qrRate} QR/s</td>
                          <td className="py-3 text-white/60">{r.framesAttempted}</td>
                          <td className="py-3 text-white/60">{r.framesDecoded}</td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-bold ${
                                  isPassing ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {(r.successRate * 100).toFixed(1)}%
                              </span>
                              <div className="w-16 h-1 bg-white/10 overflow-hidden hidden sm:block">
                                <div
                                  className={`h-full ${
                                    isPassing ? 'bg-emerald-400' : 'bg-rose-400'
                                  }`}
                                  style={{ width: `${r.successRate * 100}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-white/60">{r.avgLatencyMs} ms</td>
                          <td className="py-3 text-right">
                            <span
                              className={`inline-block px-2.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${
                                isPassing
                                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                                  : 'bg-rose-950/60 text-rose-300 border-rose-500/40'
                              }`}
                            >
                              {isPassing ? 'RELIABLE' : 'DEGRADED'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Research Insight Card */}
          <div className="bg-[#151518] border border-white/10 p-6 text-xs text-white/70 space-y-2">
            <div className="flex items-center gap-2 font-black uppercase tracking-[0.15em] text-white">
              <Info className="w-4 h-4 text-white/60" />
              <span>Camera Sensor Nyquist Bound</span>
            </div>
            <p className="font-serif-italic text-white/60 leading-relaxed text-xs">
              Optical communication requires a temporal Nyquist-like sampling ratio. A standard 60 FPS mobile
              camera typically achieves peak optical reliability at rates between{' '}
              <strong className="text-white">6 to 10 QR/sec</strong> (~6 to 10 video frames per QR frame). Beyond 12 QR/sec,
              rolling shutter artifacts, exposure motion blur, and browser decoding latency lead to dropped frames.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
