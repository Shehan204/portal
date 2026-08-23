export type ExperimentMode =
  | 'MODE_A_STATIC'
  | 'MODE_B_DYNAMIC'
  | 'MODE_C_AUTHENTICATED'
  | 'MODE_D_AUTH_RANDOM_TIMING';

export interface SessionConfig {
  mode: ExperimentMode;
  qrRate: number; // Frames per second (e.g. 1, 2, 4, 6, 8, 10, 12, 15, 20)
  durationMinutes: number;
  randomTiming: boolean;
  frameChaining: boolean;
  requiredFrames: number; // e.g. 3 or 5 consecutive / redundant frames
  timingJitterPercent: number; // e.g. 20%
}

export interface OpticalFramePayload {
  v: number; // Protocol version (1)
  sid: string; // Session ID (short token)
  seq: number; // Monotonic frame counter
  ts: number; // Timestamp (ms epoch)
  dur: number; // Frame duration / window in ms
  prevHash?: string; // Truncated hash of previous frame (frame chaining)
  sig?: string; // HMAC-SHA256 authentication tag
  mode: ExperimentMode;
}

export interface AttendanceRecord {
  id: string;
  studentName: string;
  timestamp: number;
  verificationLatencyMs: number;
  mode: ExperimentMode;
  qrRate: number;
  framesCaptured: number;
  startSeq: number;
  endSeq: number;
  clientFps: number;
  status: 'PRESENT' | 'REJECTED';
  rejectionReason?: string;
  userAgent?: string;
}

export interface ResearchMetric {
  id: string;
  sessionId: string;
  experimentMode: ExperimentMode;
  qrRate: number;
  randomTiming: boolean;
  studentName: string;
  timestamp: number;
  cameraFps: number;
  framesGenerated: number;
  framesDetected: number;
  framesMissed: number;
  decodeSuccessRate: number;
  verificationTimeMs: number;
  result: 'SUCCESS' | 'FAILURE';
  failureReason?: string;
  clientChallenge?: string;
}

export interface ActiveSession {
  id: string;
  nonce: string;
  secret: string; // Server-only HMAC secret
  config: SessionConfig;
  createdAt: number;
  expiresAt: number;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  currentSeq: number;
  lastFrameHash: string;
  framesGenerated: number;
  attendance: AttendanceRecord[];
}

export interface StudentSubmission {
  sessionId: string;
  studentName: string;
  frames: {
    seq: number;
    ts: number;
    sig?: string;
    prevHash?: string;
    rawPayload: string;
  }[];
  clientTimestamp: number;
  clientChallenge: string;
  cameraMetrics: {
    cameraFps: number;
    framesDetected: number;
    framesMissed: number;
    scanDurationMs: number;
    avgDecodeLatencyMs: number;
  };
}

export interface CalibrationResult {
  qrRate: number;
  framesAttempted: number;
  framesDecoded: number;
  successRate: number;
  avgLatencyMs: number;
  cameraFps: number;
}

export const TEACHER_PASSWORD = 'research2026';
export const DEFAULT_REQUIRED_FRAMES = 4;
export const DEFAULT_RELIABILITY_THRESHOLD = 0.95;
