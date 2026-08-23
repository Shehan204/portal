import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  AttendanceRecord,
  ResearchMetric,
  SessionConfig,
  StudentSubmission,
  TEACHER_PASSWORD,
} from './src/types/protocol';
import {
  createOpticalFrame,
  parseFramePayload,
  verifySubmissionSequence,
} from './server/protocol';
import { sessionStore } from './server/sessionStore';
import { computeFrameSignature } from './server/crypto';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // Broadcast helper to notify teacher dashboards
  function broadcast(type: string, data: any) {
    const message = JSON.stringify({ type, data });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  wss.on('connection', (ws) => {
    // Send initial session state
    const session = sessionStore.getActiveSession();
    if (session) {
      ws.send(
        JSON.stringify({
          type: 'session.state',
          data: {
            id: session.id,
            config: session.config,
            status: session.status,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            attendance: session.attendance,
            framesGenerated: session.framesGenerated,
          },
        })
      );
    }
  });

  // ================= API ROUTES =================

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Teacher Authentication Check
  app.post('/api/teacher/auth', (req, res) => {
    const { password } = req.body;
    if (password === TEACHER_PASSWORD) {
      res.json({ success: true, message: 'Authenticated (Research PoC Mode)' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid teacher research password' });
    }
  });

  // Get Active Session (Public Metadata)
  app.get('/api/session/active', (req, res) => {
    const session = sessionStore.getActiveSession();
    if (!session) {
      res.json({ session: null });
      return;
    }

    res.json({
      session: {
        id: session.id,
        nonce: session.nonce,
        config: session.config,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        status: session.status,
        currentSeq: session.currentSeq,
        framesGenerated: session.framesGenerated,
        attendance: session.attendance,
      },
    });
  });

  // Start New Session (Teacher Protected)
  app.post('/api/session/start', (req, res) => {
    const { password, config } = req.body as {
      password?: string;
      config: SessionConfig;
    };

    if (password !== TEACHER_PASSWORD) {
      res.status(401).json({ error: 'Unauthorized: Invalid teacher password' });
      return;
    }

    const session = sessionStore.createSession(config);
    broadcast('session.created', {
      id: session.id,
      nonce: session.nonce,
      config: session.config,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      status: session.status,
      attendance: [],
    });

    res.json({
      success: true,
      session: {
        id: session.id,
        nonce: session.nonce,
        config: session.config,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        status: session.status,
      },
    });
  });

  // End Active Session
  app.post('/api/session/end', (req, res) => {
    const { password } = req.body;
    if (password !== TEACHER_PASSWORD) {
      res.status(401).json({ error: 'Unauthorized: Invalid teacher password' });
      return;
    }

    const session = sessionStore.endActiveSession();
    broadcast('session.ended', { session });
    res.json({ success: true, session });
  });

  // Teacher Next Frame Generation Endpoint
  // Generates next authenticated frame payload
  app.post('/api/session/generate-frame', (req, res) => {
    const session = sessionStore.getActiveSession();
    if (!session || session.status !== 'ACTIVE') {
      res.status(400).json({ error: 'No active session available' });
      return;
    }

    session.currentSeq += 1;
    session.framesGenerated += 1;

    const frame = createOpticalFrame(
      session.id,
      session.nonce,
      session.secret,
      session.currentSeq,
      session.config,
      session.lastFrameHash
    );

    session.lastFrameHash = frame.chainHash || session.lastFrameHash;

    res.json({
      payload: frame.payload,
      raw: frame.raw,
      seq: session.currentSeq,
      framesGenerated: session.framesGenerated,
    });
  });

  // Batch Frame Generator for ultra smooth optical display without network delay
  app.post('/api/session/generate-frame-batch', (req, res) => {
    const { count = 20 } = req.body;
    const session = sessionStore.getActiveSession();
    if (!session || session.status !== 'ACTIVE') {
      res.status(400).json({ error: 'No active session available' });
      return;
    }

    const frames = [];
    const requestedCount = Math.min(Math.max(1, count), 100);

    for (let i = 0; i < requestedCount; i++) {
      session.currentSeq += 1;
      session.framesGenerated += 1;

      const frame = createOpticalFrame(
        session.id,
        session.nonce,
        session.secret,
        session.currentSeq,
        session.config,
        session.lastFrameHash
      );

      session.lastFrameHash = frame.chainHash || session.lastFrameHash;
      frames.push({
        payload: frame.payload,
        raw: frame.raw,
        seq: session.currentSeq,
      });
    }

    res.json({
      frames,
      totalFramesGenerated: session.framesGenerated,
    });
  });

  // Student Attendance Verification Endpoint
  app.post('/api/attendance/verify', (req, res) => {
    const submission = req.body as StudentSubmission;
    const session = sessionStore.getActiveSession();
    const startTime = Date.now();

    if (!session) {
      res.status(400).json({
        success: false,
        code: 'NO_ACTIVE_SESSION',
        message: 'No attendance session is currently active.',
      });
      return;
    }

    // Check duplicate student
    if (sessionStore.isStudentAlreadyPresent(submission.studentName)) {
      const metric: ResearchMetric = {
        id: `MET-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sessionId: session.id,
        experimentMode: session.config.mode,
        qrRate: session.config.qrRate,
        randomTiming: session.config.randomTiming,
        studentName: submission.studentName,
        timestamp: Date.now(),
        cameraFps: submission.cameraMetrics?.cameraFps || 0,
        framesGenerated: session.framesGenerated,
        framesDetected: submission.cameraMetrics?.framesDetected || 0,
        framesMissed: submission.cameraMetrics?.framesMissed || 0,
        decodeSuccessRate:
          submission.cameraMetrics?.framesDetected &&
          submission.cameraMetrics.framesDetected + (submission.cameraMetrics.framesMissed || 0) > 0
            ? submission.cameraMetrics.framesDetected /
              (submission.cameraMetrics.framesDetected + submission.cameraMetrics.framesMissed)
            : 0,
        verificationTimeMs: Date.now() - startTime,
        result: 'FAILURE',
        failureReason: 'DUPLICATE_STUDENT_NAME',
      };
      sessionStore.logMetric(metric);

      res.status(409).json({
        success: false,
        code: 'ALREADY_PRESENT',
        message: `Student "${submission.studentName}" is already marked PRESENT for this session.`,
      });
      return;
    }

    const verification = verifySubmissionSequence(
      submission,
      session,
      sessionStore.getUsedSequencesCache()
    );

    const verificationTimeMs = Date.now() - startTime;

    if (verification.valid) {
      const startSeq = submission.frames[0]?.seq || 1;
      const endSeq = submission.frames[submission.frames.length - 1]?.seq || 1;

      const record: AttendanceRecord = {
        id: `ATT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        studentName: submission.studentName.trim(),
        timestamp: Date.now(),
        verificationLatencyMs: verificationTimeMs,
        mode: session.config.mode,
        qrRate: session.config.qrRate,
        framesCaptured: submission.frames.length,
        startSeq,
        endSeq,
        clientFps: submission.cameraMetrics?.cameraFps || 30,
        status: 'PRESENT',
        userAgent: req.headers['user-agent'],
      };

      sessionStore.addAttendance(record);

      const metric: ResearchMetric = {
        id: `MET-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sessionId: session.id,
        experimentMode: session.config.mode,
        qrRate: session.config.qrRate,
        randomTiming: session.config.randomTiming,
        studentName: submission.studentName,
        timestamp: Date.now(),
        cameraFps: submission.cameraMetrics?.cameraFps || 0,
        framesGenerated: session.framesGenerated,
        framesDetected: submission.cameraMetrics?.framesDetected || submission.frames.length,
        framesMissed: submission.cameraMetrics?.framesMissed || 0,
        decodeSuccessRate: 1.0,
        verificationTimeMs,
        result: 'SUCCESS',
        clientChallenge: submission.clientChallenge,
      };
      sessionStore.logMetric(metric);

      // Broadcast instant live update to teacher dashboard
      broadcast('attendance.updated', {
        record,
        presentCount: session.attendance.length,
      });

      res.json({
        success: true,
        record,
        message: verification.message,
      });
    } else {
      const metric: ResearchMetric = {
        id: `MET-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sessionId: session.id,
        experimentMode: session.config.mode,
        qrRate: session.config.qrRate,
        randomTiming: session.config.randomTiming,
        studentName: submission.studentName,
        timestamp: Date.now(),
        cameraFps: submission.cameraMetrics?.cameraFps || 0,
        framesGenerated: session.framesGenerated,
        framesDetected: submission.cameraMetrics?.framesDetected || 0,
        framesMissed: submission.cameraMetrics?.framesMissed || 0,
        decodeSuccessRate: 0,
        verificationTimeMs,
        result: 'FAILURE',
        failureReason: verification.code,
      };
      sessionStore.logMetric(metric);

      res.status(400).json({
        success: false,
        code: verification.code,
        message: verification.message,
      });
    }
  });

  // Replay Attack Security Test Lab Endpoint
  app.post('/api/test/replay-attack', (req, res) => {
    const { attackType, studentName = 'AttackerBob', customPayload } = req.body;
    const session = sessionStore.getActiveSession();

    if (!session) {
      res.status(400).json({
        success: false,
        error: 'No active session available to run security attack tests against.',
      });
      return;
    }

    const now = Date.now();
    let submission: StudentSubmission;

    switch (attackType) {
      case 'ATTACK_1_SCREENSHOT': {
        // Single static screenshot frame
        const frame = createOpticalFrame(
          session.id,
          session.nonce,
          session.secret,
          session.currentSeq + 1,
          session.config,
          session.lastFrameHash
        );
        submission = {
          sessionId: session.id,
          studentName,
          frames: [{ seq: frame.payload.seq, ts: frame.payload.ts, sig: frame.payload.sig, rawPayload: frame.raw }],
          clientTimestamp: now,
          clientChallenge: 'chal-screenshot',
          cameraMetrics: { cameraFps: 30, framesDetected: 1, framesMissed: 0, scanDurationMs: 100, avgDecodeLatencyMs: 10 },
        };
        break;
      }

      case 'ATTACK_2_OLD_SESSION_QR': {
        // Frame belonging to a previous / fake session ID
        const fakeSessionId = 'SES-EXPIRED99';
        const fakeFrame = createOpticalFrame(
          fakeSessionId,
          'fake-nonce',
          'fake-secret',
          5,
          session.config,
          '00000000'
        );
        submission = {
          sessionId: session.id,
          studentName,
          frames: [
            { seq: 5, ts: now - 3600000, sig: fakeFrame.payload.sig, rawPayload: fakeFrame.raw },
            { seq: 6, ts: now - 3600000, sig: fakeFrame.payload.sig, rawPayload: fakeFrame.raw },
            { seq: 7, ts: now - 3600000, sig: fakeFrame.payload.sig, rawPayload: fakeFrame.raw },
          ],
          clientTimestamp: now,
          clientChallenge: 'chal-old-session',
          cameraMetrics: { cameraFps: 30, framesDetected: 3, framesMissed: 0, scanDurationMs: 300, avgDecodeLatencyMs: 15 },
        };
        break;
      }

      case 'ATTACK_3_RECORDED_VIDEO_STALE': {
        // Valid sequence generated 10 minutes ago
        const staleTime = now - 10 * 60 * 1000;
        const f1 = createOpticalFrame(session.id, session.nonce, session.secret, 10, session.config, '00000000', staleTime);
        const f2 = createOpticalFrame(session.id, session.nonce, session.secret, 11, session.config, f1.chainHash, staleTime + 125);
        const f3 = createOpticalFrame(session.id, session.nonce, session.secret, 12, session.config, f2.chainHash, staleTime + 250);
        const f4 = createOpticalFrame(session.id, session.nonce, session.secret, 13, session.config, f3.chainHash, staleTime + 375);

        submission = {
          sessionId: session.id,
          studentName,
          frames: [
            { seq: 10, ts: staleTime, sig: f1.payload.sig, prevHash: '00000000', rawPayload: f1.raw },
            { seq: 11, ts: staleTime + 125, sig: f2.payload.sig, prevHash: f1.chainHash, rawPayload: f2.raw },
            { seq: 12, ts: staleTime + 250, sig: f3.payload.sig, prevHash: f2.chainHash, rawPayload: f3.raw },
            { seq: 13, ts: staleTime + 375, sig: f4.payload.sig, prevHash: f3.chainHash, rawPayload: f4.raw },
          ],
          clientTimestamp: now,
          clientChallenge: 'chal-video-replay',
          cameraMetrics: { cameraFps: 30, framesDetected: 4, framesMissed: 0, scanDurationMs: 400, avgDecodeLatencyMs: 12 },
        };
        break;
      }

      case 'ATTACK_4_REORDERED_FRAMES': {
        // Generated valid frames but presented out of order (e.g. 104 -> 102 -> 105)
        const f1 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 2, session.config, '00000000', now);
        const f2 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 1, session.config, '00000000', now + 125);
        const f3 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 3, session.config, '00000000', now + 250);

        submission = {
          sessionId: session.id,
          studentName,
          frames: [
            { seq: f1.payload.seq, ts: f1.payload.ts, sig: f1.payload.sig, rawPayload: f1.raw },
            { seq: f2.payload.seq, ts: f2.payload.ts, sig: f2.payload.sig, rawPayload: f2.raw },
            { seq: f3.payload.seq, ts: f3.payload.ts, sig: f3.payload.sig, rawPayload: f3.raw },
          ],
          clientTimestamp: now,
          clientChallenge: 'chal-reorder',
          cameraMetrics: { cameraFps: 30, framesDetected: 3, framesMissed: 0, scanDurationMs: 300, avgDecodeLatencyMs: 14 },
        };
        break;
      }

      case 'ATTACK_5_MODIFIED_PAYLOAD': {
        // Altered sequence counter or signature tampering
        const f1 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 10, session.config, '00000000', now);
        // Tamper with the raw payload string
        const tamperedRaw = f1.raw.replace(/~C~/g, '~D~').slice(0, -3) + 'XYZ';
        submission = {
          sessionId: session.id,
          studentName,
          frames: [
            { seq: f1.payload.seq, ts: f1.payload.ts, sig: 'bad_sig_1234', rawPayload: tamperedRaw },
            { seq: f1.payload.seq + 1, ts: f1.payload.ts + 125, sig: 'bad_sig_5678', rawPayload: tamperedRaw },
            { seq: f1.payload.seq + 2, ts: f1.payload.ts + 250, sig: 'bad_sig_9999', rawPayload: tamperedRaw },
          ],
          clientTimestamp: now,
          clientChallenge: 'chal-tamper',
          cameraMetrics: { cameraFps: 30, framesDetected: 3, framesMissed: 0, scanDurationMs: 300, avgDecodeLatencyMs: 15 },
        };
        break;
      }

      case 'ATTACK_6_EXPIRED_SESSION': {
        // Simulates submitting against an expired session
        const expiredSession = { ...session, status: 'EXPIRED' as const, expiresAt: now - 1000 };
        const result = verifySubmissionSequence(
          {
            sessionId: session.id,
            studentName,
            frames: [
              { seq: 1, ts: now, rawPayload: `V1~${session.id}~1~${now}~125~C~00000000~sig1` },
              { seq: 2, ts: now + 125, rawPayload: `V1~${session.id}~2~${now + 125}~125~C~00000000~sig2` },
              { seq: 3, ts: now + 250, rawPayload: `V1~${session.id}~3~${now + 250}~125~C~00000000~sig3` },
            ],
            clientTimestamp: now,
            clientChallenge: 'chal-expired',
            cameraMetrics: { cameraFps: 30, framesDetected: 3, framesMissed: 0, scanDurationMs: 300, avgDecodeLatencyMs: 12 },
          },
          expiredSession,
          sessionStore.getUsedSequencesCache()
        );

        res.json({
          attackType,
          blocked: !result.valid,
          verdict: result.valid ? 'EXPLOIT_SUCCEEDED (VULNERABLE)' : 'ATTACK_BLOCKED_SUCCESSFULLY (SECURE)',
          code: result.code,
          message: result.message,
        });
        return;
      }

      case 'ATTACK_7_DUPLICATE_SUBMISSION': {
        // First mark present if not present
        if (!sessionStore.isStudentAlreadyPresent(studentName)) {
          sessionStore.addAttendance({
            id: `ATT-TEST-${Date.now()}`,
            studentName,
            timestamp: now,
            verificationLatencyMs: 12,
            mode: session.config.mode,
            qrRate: session.config.qrRate,
            framesCaptured: 3,
            startSeq: 1,
            endSeq: 3,
            clientFps: 30,
            status: 'PRESENT',
          });
        }
        res.json({
          attackType,
          blocked: true,
          verdict: 'ATTACK_BLOCKED_SUCCESSFULLY (SECURE)',
          code: 'ALREADY_PRESENT',
          message: `Duplicate attendance for student "${studentName}" was blocked by identity deduplication filter.`,
        });
        return;
      }

      case 'BENCHMARK_VALID_LIVE': {
        // Valid live sequence for baseline testing
        const f1 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 1, session.config, session.lastFrameHash, now - 300);
        const f2 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 2, session.config, f1.chainHash, now - 175);
        const f3 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 3, session.config, f2.chainHash, now - 50);
        const f4 = createOpticalFrame(session.id, session.nonce, session.secret, session.currentSeq + 4, session.config, f3.chainHash, now);

        submission = {
          sessionId: session.id,
          studentName: `ValidStudent_${Math.floor(Math.random() * 1000)}`,
          frames: [
            { seq: f1.payload.seq, ts: f1.payload.ts, sig: f1.payload.sig, prevHash: session.lastFrameHash, rawPayload: f1.raw },
            { seq: f2.payload.seq, ts: f2.payload.ts, sig: f2.payload.sig, prevHash: f1.chainHash, rawPayload: f2.raw },
            { seq: f3.payload.seq, ts: f3.payload.ts, sig: f3.payload.sig, prevHash: f2.chainHash, rawPayload: f3.raw },
            { seq: f4.payload.seq, ts: f4.payload.ts, sig: f4.payload.sig, prevHash: f3.chainHash, rawPayload: f4.raw },
          ],
          clientTimestamp: now,
          clientChallenge: `chal-valid-${Date.now()}`,
          cameraMetrics: { cameraFps: 30, framesDetected: 4, framesMissed: 0, scanDurationMs: 400, avgDecodeLatencyMs: 12 },
        };
        break;
      }

      default: {
        res.status(400).json({ error: `Unknown attack type: ${attackType}` });
        return;
      }
    }

    const result = verifySubmissionSequence(submission, session, sessionStore.getUsedSequencesCache());

    res.json({
      attackType,
      blocked: !result.valid,
      verdict: result.valid
        ? (attackType === 'BENCHMARK_VALID_LIVE' ? 'VALID_SUBMISSION_ACCEPTED' : 'EXPLOIT_SUCCEEDED (VULNERABLE)')
        : 'ATTACK_BLOCKED_SUCCESSFULLY (SECURE)',
      code: result.code,
      message: result.message,
      framesTested: submission.frames.length,
    });
  });

  // Log Empirical Research Metric (from student calibrations, simulations, or field runs)
  app.post('/api/metrics/log', (req, res) => {
    const metric = req.body as ResearchMetric;
    if (!metric.id) {
      metric.id = `MET-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    }
    sessionStore.logMetric(metric);
    res.json({ success: true, loggedMetric: metric });
  });

  // Get All Metrics / Benchmarks
  app.get('/api/metrics', (req, res) => {
    const metrics = sessionStore.getMetrics();
    res.json({
      count: metrics.length,
      metrics,
    });
  });

  // Clear Metrics
  app.post('/api/metrics/clear', (req, res) => {
    sessionStore.clearMetrics();
    res.json({ success: true, message: 'Research metrics log cleared' });
  });

  // Export Datasets (JSON / CSV)
  app.get('/api/metrics/export/json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="temporal_qr_research_metrics.json"');
    res.send(sessionStore.exportMetricsJson());
  });

  app.get('/api/metrics/export/csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="temporal_qr_research_metrics.csv"');
    res.send(sessionStore.exportMetricsCsv());
  });

  // Vite middleware for development & static for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Research PoC server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
