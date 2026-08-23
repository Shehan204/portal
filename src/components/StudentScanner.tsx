import React, { useEffect, useRef, useState } from 'react';
import { AttendanceRecord, OpticalFramePayload } from '../types/protocol';
import { parseClientFramePayload, generateClientChallenge } from '../utils/cryptoClient';
import { QRScannerEngine } from '../utils/qrDecoder';
import { submitAttendance } from '../utils/network';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  RefreshCw,
  Sliders,
  AlertTriangle,
  User,
  ShieldCheck,
  Zap,
  Activity,
  ArrowRight,
} from 'lucide-react';

interface StudentScannerProps {
  onOpenCalibration: () => void;
}

export const StudentScanner: React.FC<StudentScannerProps> = ({ onOpenCalibration }) => {
  // Flow step: 'NAME_ENTRY' | 'SCANNING' | 'SUCCESS' | 'ERROR'
  const [step, setStep] = useState<'NAME_ENTRY' | 'SCANNING' | 'SUCCESS' | 'ERROR'>('NAME_ENTRY');
  const [studentName, setStudentName] = useState<string>(() => {
    return sessionStorage.getItem('student_name') || '';
  });

  // Camera & Stream State
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFps, setCameraFps] = useState<number>(0);
  const [decodeEngine, setDecodeEngine] = useState<string>('Initializing');

  // Temporal Frame Buffer
  const [capturedFrames, setCapturedFrames] = useState<
    { seq: number; ts: number; sig?: string; prevHash?: string; rawPayload: string }[]
  >([]);
  const [requiredFramesTarget, setRequiredFramesTarget] = useState<number>(4);
  const [lastDetectedSeq, setLastDetectedSeq] = useState<number | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Success / Error Outcome State
  const [successRecord, setSuccessRecord] = useState<AttendanceRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Telemetry metrics
  const scanStartTimeRef = useRef<number>(0);
  const totalDetectionsRef = useRef<number>(0);
  const totalMissesRef = useRef<number>(0);
  const latencySumRef = useRef<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerEngineRef = useRef<QRScannerEngine | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const capturedBufferRef = useRef<
    { seq: number; ts: number; sig?: string; prevHash?: string; rawPayload: string }[]
  >([]);

  // Initialize Scanner Engine
  useEffect(() => {
    scannerEngineRef.current = new QRScannerEngine();
    setDecodeEngine(scannerEngineRef.current.getEngineName());
  }, []);

  // Handle Name Submit
  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim()) return;
    sessionStorage.setItem('student_name', studentName.trim());
    setStep('SCANNING');
    startCamera();
  };

  // Start Camera Stream
  const startCamera = async () => {
    setCameraError(null);
    capturedBufferRef.current = [];
    setCapturedFrames([]);
    scanStartTimeRef.current = Date.now();
    totalDetectionsRef.current = 0;
    totalMissesRef.current = 0;
    latencySumRef.current = 0;

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, min: 30 },
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
      startScanLoop();
    } catch (err: any) {
      console.error('Camera access error:', err);
      setCameraError(
        'Unable to access camera. Please ensure camera permissions are granted in your browser.'
      );
      setCameraActive(false);
    }
  };

  // Stop Camera Stream
  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Main High-Speed Camera Processing Loop
  const startScanLoop = () => {
    const processFrame = async () => {
      if (!videoRef.current || !scannerEngineRef.current || !cameraActive) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const result = await scannerEngineRef.current.scanVideoFrame(videoRef.current);
      setCameraFps(scannerEngineRef.current.getFps());

      if (result && result.data) {
        totalDetectionsRef.current += 1;
        latencySumRef.current += result.decodeLatencyMs;

        const payload = parseClientFramePayload(result.data);
        if (payload) {
          setLastDetectedSeq(payload.seq);

          // Check if frame is already in buffer
          const alreadyInBuffer = capturedBufferRef.current.some((f) => f.seq === payload.seq);

          if (!alreadyInBuffer) {
            // Mode A (Static) only needs 1 frame
            if (payload.mode === 'MODE_A_STATIC') {
              capturedBufferRef.current = [
                {
                  seq: payload.seq,
                  ts: payload.ts,
                  sig: payload.sig,
                  prevHash: payload.prevHash,
                  rawPayload: result.data,
                },
              ];
              setCapturedFrames([...capturedBufferRef.current]);
              submitCurrentBuffer(payload.sid);
              return;
            }

            // Mode B, C, D: Check monotonic increasing sequence
            const lastFrame = capturedBufferRef.current[capturedBufferRef.current.length - 1];
            if (!lastFrame || payload.seq > lastFrame.seq) {
              capturedBufferRef.current.push({
                seq: payload.seq,
                ts: payload.ts,
                sig: payload.sig,
                prevHash: payload.prevHash,
                rawPayload: result.data,
              });

              setCapturedFrames([...capturedBufferRef.current]);

              // If reached required frames, trigger verification immediately
              if (capturedBufferRef.current.length >= requiredFramesTarget && !isVerifying) {
                submitCurrentBuffer(payload.sid);
                return;
              }
            } else if (payload.seq < lastFrame.seq) {
              // Reset buffer on fresh session or discontinuous backwards jump
              capturedBufferRef.current = [
                {
                  seq: payload.seq,
                  ts: payload.ts,
                  sig: payload.sig,
                  prevHash: payload.prevHash,
                  rawPayload: result.data,
                },
              ];
              setCapturedFrames([...capturedBufferRef.current]);
            }
          }
        }
      } else {
        totalMissesRef.current += 1;
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);
  };

  // Submit Captured Sequence to Server
  const submitCurrentBuffer = async (sessionId: string) => {
    setIsVerifying(true);
    stopCamera();

    const scanDurationMs = Date.now() - scanStartTimeRef.current;
    const avgLatency =
      totalDetectionsRef.current > 0 ? latencySumRef.current / totalDetectionsRef.current : 10;

    const challenge = generateClientChallenge();

    const response = await submitAttendance({
      sessionId,
      studentName: studentName.trim(),
      frames: capturedBufferRef.current,
      clientTimestamp: Date.now(),
      clientChallenge: challenge,
      cameraMetrics: {
        cameraFps: cameraFps || 30,
        framesDetected: totalDetectionsRef.current,
        framesMissed: totalMissesRef.current,
        scanDurationMs,
        avgDecodeLatencyMs: Math.round(avgLatency),
      },
    });

    setIsVerifying(false);

    if (response.success && response.record) {
      setSuccessRecord(response.record);
      setStep('SUCCESS');
    } else {
      setErrorCode(response.code || 'VERIFICATION_FAILED');
      setErrorMessage(response.message || 'Verification rejected by attendance authority.');
      setStep('ERROR');
    }
  };

  // Reset and try scanning again
  const handleReset = () => {
    setCapturedFrames([]);
    capturedBufferRef.current = [];
    setSuccessRecord(null);
    setErrorMessage(null);
    setErrorCode(null);
    setStep('SCANNING');
    startCamera();
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      {/* 1. Name Entry Step */}
      {step === 'NAME_ENTRY' && (
        <div className="bg-[#151518] border border-white/10 p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute -right-4 -bottom-4 text-9xl font-black text-white/5 pointer-events-none select-none">
            02
          </div>
          <div className="w-10 h-10 bg-white text-black flex items-center justify-center mb-6">
            <User className="w-5 h-5" />
          </div>

          <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/40 block mb-2">
            Module 02 // Client Observer
          </span>

          <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mb-2 leading-[0.95]">
            STUDENT <span className="text-stroke-subtle text-transparent">SCANNER.</span>
          </h1>

          <p className="font-serif-italic text-sm text-white/60 mb-6 leading-relaxed">
            Enter your student identity to begin high-speed optical camera observation of the teacher's dynamic screen.
          </p>

          <form onSubmit={handleNameSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-white/70 mb-2">
                Student Full Name
              </label>
              <input
                id="student-name-input"
                type="text"
                required
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="e.g. Shehan Perera"
                className="w-full px-4 py-3 bg-[#0F0F11] border border-white/15 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-white font-mono"
                autoFocus
              />
            </div>

            <button
              id="student-continue-btn"
              type="submit"
              className="w-full py-3.5 bg-white hover:bg-zinc-200 text-black font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center gap-2"
            >
              <span>ENGAGE OPTICAL CAMERA</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between text-xs text-white/40">
            <span className="font-mono text-[10px] uppercase tracking-wider">Zero Registration Required</span>
            <button
              onClick={onOpenCalibration}
              className="text-white hover:underline font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5 text-white/70" />
              <span>Calibrate Sensor</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Camera Scanning Step */}
      {step === 'SCANNING' && (
        <div className="bg-[#151518] text-white p-6 shadow-2xl border border-white/10 flex flex-col items-center relative">
          {/* Header Bar */}
          <div className="w-full flex items-center justify-between pb-3 border-b border-white/10 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="font-bold text-white font-mono uppercase tracking-wider text-xs">
                {studentName}
              </span>
            </div>
            <div className="font-mono text-[11px] text-white/50">
              FPS: <strong className="text-white font-bold">{cameraFps}</strong> | {decodeEngine}
            </div>
          </div>

          {/* Video Viewport Container */}
          <div className="relative w-full aspect-square bg-black my-5 border-2 border-white/15 overflow-hidden flex items-center justify-center">
            {cameraError ? (
              <div className="p-6 text-center text-xs text-rose-400 flex flex-col items-center font-mono">
                <AlertTriangle className="w-8 h-8 mb-2 text-rose-500" />
                <p>{cameraError}</p>
                <button
                  onClick={startCamera}
                  className="mt-4 px-4 py-2 bg-white text-black font-black uppercase text-xs"
                >
                  Retry Camera
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />

                {/* Target Reticle */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-3/4 h-3/4 border border-dashed border-white/40 relative flex items-center justify-center">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white"></div>
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white"></div>
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white"></div>
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white"></div>

                    {isVerifying ? (
                      <div className="bg-black/90 text-emerald-400 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider animate-pulse flex items-center gap-2 border border-emerald-500/40">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Verifying Cryptographic Chaining...</span>
                      </div>
                    ) : (
                      <div className="text-[10px] font-mono font-bold tracking-widest text-white uppercase bg-black/80 px-3 py-1 border border-white/20">
                        ALIGN DYNAMIC QR
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Temporal Frame Capture Progress Gauge */}
          <div className="w-full bg-[#0F0F11] p-4 border border-white/10 space-y-2.5">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-white/40 uppercase tracking-wider text-[10px] font-bold">
                Temporal Sequence Progress
              </span>
              <span className="text-emerald-400 font-bold">
                {capturedFrames.length} / {requiredFramesTarget} Valid Frames
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-1.5 bg-white/10 overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-150 ease-out"
                style={{
                  width: `${Math.min(100, (capturedFrames.length / requiredFramesTarget) * 100)}%`,
                }}
              />
            </div>

            <div className="flex justify-between items-center text-[10px] font-mono text-white/50 pt-1">
              <span>Seq: {lastDetectedSeq ? `#${lastDetectedSeq}` : 'Searching...'}</span>
              <span className="uppercase tracking-wider">
                {capturedFrames.length === 0
                  ? 'Optical sensor standby...'
                  : capturedFrames.length < requiredFramesTarget
                  ? 'Sampling optical stream...'
                  : 'Quorum locked. Authenticating...'}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="w-full flex items-center justify-between gap-2 mt-4 pt-3 border-t border-white/10 text-xs">
            <button
              onClick={() => {
                setCameraFacing((prev) => (prev === 'environment' ? 'user' : 'environment'));
                setTimeout(startCamera, 100);
              }}
              className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 text-xs font-mono uppercase tracking-wider transition-colors"
            >
              Switch Lens
            </button>

            <button
              onClick={() => setStep('NAME_ENTRY')}
              className="px-3.5 py-2 text-white/40 hover:text-white font-mono text-xs uppercase tracking-wider transition-colors"
            >
              Edit Name
            </button>
          </div>
        </div>
      )}

      {/* 3. Success Step */}
      {step === 'SUCCESS' && successRecord && (
        <div className="bg-[#151518] border border-emerald-500/40 p-8 shadow-2xl text-center relative overflow-hidden">
          <div className="w-16 h-16 bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-emerald-400 block mb-1">
            Verification Complete &bull; 200 OK
          </span>

          <h2 className="text-3xl font-black uppercase tracking-tight text-white mb-2">
            ATTENDANCE RECORDED
          </h2>
          <p className="font-mono text-sm font-bold text-emerald-300 uppercase tracking-widest mb-6">
            STATUS: PRESENT
          </p>

          <div className="bg-[#0F0F11] border border-white/10 p-5 text-left font-mono text-xs space-y-2.5 mb-6 text-white/80">
            <div className="flex justify-between border-b border-white/5 pb-1.5">
              <span className="text-white/40 uppercase">Student Name</span>
              <strong className="text-white font-bold">{successRecord.studentName}</strong>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-1.5">
              <span className="text-white/40 uppercase">Recorded At</span>
              <span>{new Date(successRecord.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-1.5">
              <span className="text-white/40 uppercase">Verification Latency</span>
              <span className="text-emerald-400">{successRecord.verificationLatencyMs} ms</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-1.5">
              <span className="text-white/40 uppercase">Optical Frames</span>
              <span>{successRecord.framesCaptured} Chained Frames</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40 uppercase">Protocol Mode</span>
              <span className="text-white font-bold">{successRecord.mode}</span>
            </div>
          </div>

          <button
            id="scan-again-btn"
            onClick={handleReset}
            className="w-full py-3.5 bg-white hover:bg-zinc-200 text-black font-black uppercase tracking-[0.2em] text-xs transition-colors"
          >
            Scan Another Session
          </button>
        </div>
      )}

      {/* 4. Error / Replay Step */}
      {step === 'ERROR' && (
        <div className="bg-[#151518] border border-rose-500/40 p-8 shadow-2xl text-center relative">
          <div className="w-16 h-16 bg-rose-950/60 border border-rose-500/50 text-rose-400 flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-10 h-10" />
          </div>

          <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-rose-400 block mb-1">
            Security Exception
          </span>

          <h2 className="text-3xl font-black uppercase tracking-tight text-white mb-2">
            VERIFICATION REJECTED
          </h2>
          <p className="text-xs font-mono font-bold text-rose-400 uppercase tracking-widest mb-5">
            ERR_CODE: {errorCode}
          </p>

          <div className="p-4 bg-[#0F0F11] border border-rose-500/30 text-xs font-mono text-rose-300 text-left mb-6 leading-relaxed">
            {errorMessage}
          </div>

          <button
            onClick={handleReset}
            className="w-full py-3.5 bg-white hover:bg-zinc-200 text-black font-black uppercase tracking-[0.2em] text-xs transition-colors"
          >
            Re-Attempt Optical Scan
          </button>
        </div>
      )}
    </div>
  );
};
