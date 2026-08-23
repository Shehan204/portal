import {
  ExperimentMode,
  OpticalFramePayload,
  SessionConfig,
  StudentSubmission,
} from '../src/types/protocol';
import {
  computeChainHash,
  computeFrameSignature,
  verifySignatureTimingSafe,
} from './crypto';

export interface VerificationResult {
  valid: boolean;
  code: string;
  message: string;
  framesVerified?: number;
  mode?: ExperimentMode;
}

/**
 * Compact representation serializer:
 * Format: V1~<sid>~<seq>~<ts>~<dur>~<mode_code>~<prevHash>~<sig>
 * Minimizes payload bytes for lower QR Version and maximum mobile camera decoding reliability.
 */
export function serializeFramePayload(payload: OpticalFramePayload): string {
  const modeCodeMap: Record<ExperimentMode, string> = {
    MODE_A_STATIC: 'A',
    MODE_B_DYNAMIC: 'B',
    MODE_C_AUTHENTICATED: 'C',
    MODE_D_AUTH_RANDOM_TIMING: 'D',
  };

  const modeCode = modeCodeMap[payload.mode] || 'C';
  const parts = [
    `V${payload.v}`,
    payload.sid,
    payload.seq.toString(),
    payload.ts.toString(),
    payload.dur.toString(),
    modeCode,
    payload.prevHash || '',
    payload.sig || '',
  ];

  return parts.join('~');
}

/**
 * Compact representation parser
 */
export function parseFramePayload(raw: string): OpticalFramePayload | null {
  try {
    if (raw.startsWith('{')) {
      return JSON.parse(raw) as OpticalFramePayload;
    }

    const parts = raw.split('~');
    if (parts.length < 6) return null;

    const codeToModeMap: Record<string, ExperimentMode> = {
      A: 'MODE_A_STATIC',
      B: 'MODE_B_DYNAMIC',
      C: 'MODE_C_AUTHENTICATED',
      D: 'MODE_D_AUTH_RANDOM_TIMING',
    };

    const v = parseInt(parts[0].replace('V', ''), 10) || 1;
    const sid = parts[1];
    const seq = parseInt(parts[2], 10);
    const ts = parseInt(parts[3], 10);
    const dur = parseInt(parts[4], 10);
    const mode = codeToModeMap[parts[5]] || 'MODE_C_AUTHENTICATED';
    const prevHash = parts[6] || undefined;
    const sig = parts[7] || undefined;

    return {
      v,
      sid,
      seq,
      ts,
      dur,
      mode,
      prevHash,
      sig,
    };
  } catch {
    return null;
  }
}

/**
 * Generates an optical frame based on the current session state and config
 */
export function createOpticalFrame(
  sessionId: string,
  sessionNonce: string,
  sessionSecret: string,
  seq: number,
  config: SessionConfig,
  prevChainHash: string,
  overrideTs?: number,
  overrideDur?: number
): { payload: OpticalFramePayload; raw: string; chainHash: string } {
  const ts = overrideTs !== undefined ? overrideTs : Date.now();
  let dur = Math.round(1000 / config.qrRate);

  if (config.randomTiming && config.mode === 'MODE_D_AUTH_RANDOM_TIMING') {
    const jitterFactor = (config.timingJitterPercent || 20) / 100;
    const delta = dur * jitterFactor;
    const randomShift = (Math.random() * 2 - 1) * delta;
    dur = Math.max(30, Math.round(dur + randomShift));
  }
  if (overrideDur !== undefined) {
    dur = overrideDur;
  }

  // Calculate chain hash
  const chainHash = config.frameChaining
    ? computeChainHash(prevChainHash, seq, ts, sessionNonce)
    : '';

  // In Mode A (Static), the frame counter & timestamp are frozen
  const frameSeq = config.mode === 'MODE_A_STATIC' ? 1 : seq;
  const frameTs = config.mode === 'MODE_A_STATIC' ? 0 : ts;

  const payloadDataToSign = `${sessionId}:${frameSeq}:${frameTs}:${dur}:${chainHash}:${sessionNonce}`;

  let sig: string | undefined = undefined;
  if (config.mode === 'MODE_C_AUTHENTICATED' || config.mode === 'MODE_D_AUTH_RANDOM_TIMING') {
    sig = computeFrameSignature(payloadDataToSign, sessionSecret);
  }

  const payload: OpticalFramePayload = {
    v: 1,
    sid: sessionId,
    seq: frameSeq,
    ts: frameTs,
    dur,
    mode: config.mode,
    prevHash: config.frameChaining ? prevChainHash : undefined,
    sig,
  };

  const raw = serializeFramePayload(payload);
  return { payload, raw, chainHash };
}

/**
 * Server-side sequence verification engine
 */
export function verifySubmissionSequence(
  submission: StudentSubmission,
  session: {
    id: string;
    secret: string;
    nonce: string;
    config: SessionConfig;
    createdAt: number;
    expiresAt: number;
    status: string;
    currentSeq: number;
  },
  usedSequencesCache: Set<string>
): VerificationResult {
  const now = Date.now();

  // 1. Session status check
  if (session.status !== 'ACTIVE') {
    return {
      valid: false,
      code: 'SESSION_NOT_ACTIVE',
      message: `Session is currently ${session.status}`,
    };
  }

  // 2. Session expiration check
  if (now > session.expiresAt) {
    return {
      valid: false,
      code: 'SESSION_EXPIRED',
      message: 'Session has expired.',
    };
  }

  const { frames, studentName, clientChallenge } = submission;

  if (!studentName || studentName.trim().length === 0) {
    return {
      valid: false,
      code: 'INVALID_STUDENT_NAME',
      message: 'Student name is required.',
    };
  }

  // Handle Mode A (Static baseline)
  if (session.config.mode === 'MODE_A_STATIC') {
    if (!frames || frames.length === 0) {
      return {
        valid: false,
        code: 'NO_FRAMES',
        message: 'No optical frames received.',
      };
    }
    const frame = parseFramePayload(frames[0].rawPayload);
    if (!frame || frame.sid !== session.id) {
      return {
        valid: false,
        code: 'STATIC_SESSION_MISMATCH',
        message: 'Static QR belongs to an invalid session.',
      };
    }
    return {
      valid: true,
      code: 'STATIC_SUCCESS',
      message: 'Static QR verified (Baseline Mode A).',
      framesVerified: 1,
      mode: 'MODE_A_STATIC',
    };
  }

  // 3. Minimum frame count requirement
  const requiredCount = session.config.requiredFrames || 10;
  if (!frames || frames.length < requiredCount) {
    return {
      valid: false,
      code: 'INSUFFICIENT_FRAMES',
      message: `Received ${frames?.length || 0} frames, but ${requiredCount} valid temporal frames are required.`,
    };
  }

  // Parse all frames
  const parsedFrames: OpticalFramePayload[] = [];
  for (let i = 0; i < frames.length; i++) {
    const p = parseFramePayload(frames[i].rawPayload);
    if (!p) {
      return {
        valid: false,
        code: 'CORRUPTED_FRAME_PAYLOAD',
        message: `Frame at index ${i} has invalid syntax or is corrupted.`,
      };
    }
    if (p.sid !== session.id) {
      return {
        valid: false,
        code: 'SESSION_ID_MISMATCH',
        message: `Frame session ID ${p.sid} does not match active session ${session.id}.`,
      };
    }
    parsedFrames.push(p);
  }

  // 4. Monotonic Frame Sequence & Redundancy Check
  // Frames must be in strictly increasing sequence order (e.g. 10, 11, 12 or 10, 11, 13)
  for (let i = 1; i < parsedFrames.length; i++) {
    if (parsedFrames[i].seq <= parsedFrames[i - 1].seq) {
      return {
        valid: false,
        code: 'FRAME_REORDERED_OR_DUPLICATED',
        message: `Sequence violation: Frame ${parsedFrames[i].seq} appears after ${parsedFrames[i - 1].seq}. Reordered frames rejected.`,
      };
    }

    // Check reasonable sequence gap (tolerates dropped frames up to max 5 frames gap)
    const gap = parsedFrames[i].seq - parsedFrames[i - 1].seq;
    if (gap > 6) {
      return {
        valid: false,
        code: 'FRAME_GAP_TOO_LARGE',
        message: `Gap between frame ${parsedFrames[i - 1].seq} and ${parsedFrames[i].seq} is too large (${gap} frames missed).`,
      };
    }
  }

  // 5. Real-time Live Window Verification
  // The latest frame timestamp must be recent (preventing recorded video playback hours later)
  const latestFrame = parsedFrames[parsedFrames.length - 1];
  const maxAllowedAgeMs = 15000; // 15 seconds window for camera capture + network roundtrip
  const frameAge = now - latestFrame.ts;

  if (frameAge > maxAllowedAgeMs) {
    return {
      valid: false,
      code: 'STALE_TIMING_REPLAY',
      message: `Temporal frame is stale (${Math.round(frameAge / 1000)}s old). Prerecorded video / stale replay detected.`,
    };
  }

  if (latestFrame.ts > now + 3000) {
    return {
      valid: false,
      code: 'FUTURE_TIMESTAMP_REJECTED',
      message: 'Frame timestamp is in the future. Clock skew or tampering detected.',
    };
  }

  // 6. Cryptographic HMAC & Frame Chaining Authentication (Modes C and D)
  if (
    session.config.mode === 'MODE_C_AUTHENTICATED' ||
    session.config.mode === 'MODE_D_AUTH_RANDOM_TIMING'
  ) {
    for (let i = 0; i < parsedFrames.length; i++) {
      const f = parsedFrames[i];
      if (!f.sig) {
        return {
          valid: false,
          code: 'MISSING_SIGNATURE',
          message: `Frame ${f.seq} is missing cryptographic authentication tag.`,
        };
      }

      // Reconstruct expected chain hash
      const chainHash = session.config.frameChaining
        ? computeChainHash(f.prevHash || '', f.seq, f.ts, session.nonce)
        : '';

      const expectedData = `${session.id}:${f.seq}:${f.ts}:${f.dur}:${chainHash}:${session.nonce}`;
      const expectedSig = computeFrameSignature(expectedData, session.secret);

      if (!verifySignatureTimingSafe(f.sig, expectedSig)) {
        return {
          valid: false,
          code: 'INVALID_SIGNATURE_TAMPERED',
          message: `Cryptographic authentication failed for frame ${f.seq}. Payload has been modified or forged.`,
        };
      }
    }
  }

  // 7. Replay Cache Check
  // Check if this exact frame sequence signature hash has been used by another submission
  const sequenceFingerprint = `${session.id}:${parsedFrames.map((f) => f.seq).join(',')}:${clientChallenge}`;
  if (usedSequencesCache.has(sequenceFingerprint)) {
    return {
      valid: false,
      code: 'REPLAY_SEQUENCE_ALREADY_USED',
      message: 'This exact optical sequence token has already been submitted. Replay attack blocked.',
    };
  }
  usedSequencesCache.add(sequenceFingerprint);

  return {
    valid: true,
    code: 'VERIFICATION_SUCCESS',
    message: `Verified ${parsedFrames.length} consecutive temporal frames successfully.`,
    framesVerified: parsedFrames.length,
    mode: session.config.mode,
  };
}
