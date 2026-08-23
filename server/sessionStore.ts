import {
  ActiveSession,
  AttendanceRecord,
  ExperimentMode,
  ResearchMetric,
  SessionConfig,
} from '../src/types/protocol';
import {
  generateSecureNonce,
  generateSessionId,
  generateSessionSecret,
} from './crypto';

class SessionStore {
  private activeSession: ActiveSession | null = null;
  private pastSessions: ActiveSession[] = [];
  private researchMetrics: ResearchMetric[] = [];
  private usedSequencesCache: Set<string> = new Set();

  constructor() {
    // Initialize default demo session for immediate readiness
    this.createSession({
      mode: 'MODE_C_AUTHENTICATED',
      qrRate: 8,
      durationMinutes: 10,
      randomTiming: false,
      frameChaining: true,
      requiredFrames: 10,
      timingJitterPercent: 20,
    });
  }

  public createSession(config: SessionConfig): ActiveSession {
    if (this.activeSession && this.activeSession.status === 'ACTIVE') {
      this.activeSession.status = 'ENDED';
      this.pastSessions.push(this.activeSession);
    }

    const id = generateSessionId();
    const nonce = generateSecureNonce(16);
    const secret = generateSessionSecret();
    const now = Date.now();
    const expiresAt = now + config.durationMinutes * 60 * 1000;

    const newSession: ActiveSession = {
      id,
      nonce,
      secret,
      config,
      createdAt: now,
      expiresAt,
      status: 'ACTIVE',
      currentSeq: 0,
      lastFrameHash: '00000000',
      framesGenerated: 0,
      attendance: [],
    };

    this.activeSession = newSession;
    return newSession;
  }

  public getActiveSession(): ActiveSession | null {
    if (!this.activeSession) return null;
    if (Date.now() > this.activeSession.expiresAt && this.activeSession.status === 'ACTIVE') {
      this.activeSession.status = 'EXPIRED';
    }
    return this.activeSession;
  }

  public endActiveSession(): ActiveSession | null {
    if (this.activeSession) {
      this.activeSession.status = 'ENDED';
      this.pastSessions.push(this.activeSession);
    }
    return this.activeSession;
  }

  public getUsedSequencesCache(): Set<string> {
    return this.usedSequencesCache;
  }

  public addAttendance(record: AttendanceRecord): boolean {
    if (!this.activeSession) return false;
    if (!this.activeSession.attendance) {
      this.activeSession.attendance = [];
    }
    // Check if student is already marked present
    const existing = this.activeSession.attendance.find(
      (a) => a.studentName.trim().toLowerCase() === record.studentName.trim().toLowerCase() && a.status === 'PRESENT'
    );
    if (existing) {
      return false;
    }
    this.activeSession.attendance.unshift(record);
    return true;
  }

  public isStudentAlreadyPresent(name: string): boolean {
    if (!this.activeSession) return false;
    return this.activeSession.attendance.some(
      (a) => a.studentName.trim().toLowerCase() === name.trim().toLowerCase() && a.status === 'PRESENT'
    );
  }

  public logMetric(metric: ResearchMetric): void {
    this.researchMetrics.push(metric);
  }

  public getMetrics(): ResearchMetric[] {
    return this.researchMetrics;
  }

  public clearMetrics(): void {
    this.researchMetrics = [];
  }

  public exportMetricsJson(): string {
    return JSON.stringify(
      {
        exportTimestamp: new Date().toISOString(),
        totalRecords: this.researchMetrics.length,
        metrics: this.researchMetrics,
      },
      null,
      2
    );
  }

  public exportMetricsCsv(): string {
    if (this.researchMetrics.length === 0) {
      return 'id,sessionId,experimentMode,qrRate,randomTiming,studentName,timestamp,cameraFps,framesGenerated,framesDetected,framesMissed,decodeSuccessRate,verificationTimeMs,result,failureReason\n';
    }

    const headers = [
      'id',
      'sessionId',
      'experimentMode',
      'qrRate',
      'randomTiming',
      'studentName',
      'timestamp',
      'cameraFps',
      'framesGenerated',
      'framesDetected',
      'framesMissed',
      'decodeSuccessRate',
      'verificationTimeMs',
      'result',
      'failureReason',
    ];

    const rows = this.researchMetrics.map((m) =>
      [
        `"${m.id}"`,
        `"${m.sessionId}"`,
        `"${m.experimentMode}"`,
        m.qrRate,
        m.randomTiming,
        `"${m.studentName}"`,
        m.timestamp,
        m.cameraFps.toFixed(1),
        m.framesGenerated,
        m.framesDetected,
        m.framesMissed,
        (m.decodeSuccessRate * 100).toFixed(1),
        m.verificationTimeMs,
        `"${m.result}"`,
        `"${m.failureReason || ''}"`,
      ].join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }
}

export const sessionStore = new SessionStore();
