import {
  ActiveSession,
  AttendanceRecord,
  ResearchMetric,
  SessionConfig,
  StudentSubmission,
} from '../types/protocol';

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private isConnecting = false;

  constructor() {
    this.connect();
  }

  public connect() {
    if (typeof window === 'undefined' || this.isConnecting) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.isConnecting = true;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.emit('connection.status', { connected: true });
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          this.emit(parsed.type, parsed.data);
        } catch {
          // ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.emit('connection.status', { connected: false });
        setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        this.emit('connection.status', { connected: false });
      };
    } catch {
      this.isConnecting = false;
    }
  }

  public on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const realtimeClient = new RealtimeClient();

// API Helpers
export async function getActiveSession(): Promise<ActiveSession | null> {
  try {
    const res = await fetch('/api/session/active');
    const data = await res.json();
    return data.session;
  } catch {
    return null;
  }
}

export async function verifyTeacherPassword(password: string): Promise<boolean> {
  try {
    const res = await fetch('/api/teacher/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

export async function startSession(
  password: string,
  config: SessionConfig
): Promise<{ success: boolean; session?: ActiveSession; error?: string }> {
  try {
    const res = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, config }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to start session' };
    }
    return { success: true, session: data.session };
  } catch (e: any) {
    return { success: false, error: e.message || 'Network error' };
  }
}

export async function endSession(
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    return { success: res.ok, error: data.error };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function submitAttendance(
  submission: StudentSubmission
): Promise<{ success: boolean; record?: AttendanceRecord; code?: string; message: string }> {
  try {
    const res = await fetch('/api/attendance/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    });
    const data = await res.json();
    return {
      success: data.success,
      record: data.record,
      code: data.code,
      message: data.message,
    };
  } catch (e: any) {
    return {
      success: false,
      code: 'NETWORK_ERROR',
      message: e.message || 'Failed to connect to verification server',
    };
  }
}

export async function runSecurityTest(
  attackType: string,
  studentName?: string
): Promise<{
  attackType: string;
  blocked: boolean;
  verdict: string;
  code: string;
  message: string;
  framesTested?: number;
}> {
  const res = await fetch('/api/test/replay-attack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attackType, studentName }),
  });
  return res.json();
}

export async function fetchMetrics(): Promise<{ count: number; metrics: ResearchMetric[] }> {
  try {
    const res = await fetch('/api/metrics');
    return res.json();
  } catch {
    return { count: 0, metrics: [] };
  }
}

export async function logResearchMetric(metric: Partial<ResearchMetric>): Promise<void> {
  try {
    await fetch('/api/metrics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metric),
    });
  } catch {
    // Ignore logging errors
  }
}

export async function clearResearchMetrics(): Promise<void> {
  try {
    await fetch('/api/metrics/clear', { method: 'POST' });
  } catch {
    // Ignore
  }
}
