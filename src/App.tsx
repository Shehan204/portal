import React, { useEffect, useState } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { TeacherDashboard } from './components/TeacherDashboard';
import { StudentScanner } from './components/StudentScanner';
import { SecurityTestLab } from './components/SecurityTestLab';
import { CameraCalibration } from './components/CameraCalibration';
import { ResearchBenchmarks } from './components/ResearchBenchmarks';
import { ThreatModelDoc } from './components/ThreatModelDoc';
import { getActiveSession, realtimeClient } from './utils/network';
import { ActiveSession } from './types/protocol';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('teacher');
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    // Initial fetch
    getActiveSession().then((s) => setSession(s));

    // WebSocket listeners
    const unsubConn = realtimeClient.on('connection.status', (data: { connected: boolean }) => {
      setIsConnected(data.connected);
    });

    const unsubState = realtimeClient.on('session.state', (data: any) => {
      setSession((prev) => (prev ? { ...prev, ...data } : data));
    });

    const unsubCreated = realtimeClient.on('session.created', (data: any) => {
      setSession(data);
    });

    const unsubEnded = realtimeClient.on('session.ended', () => {
      getActiveSession().then((s) => setSession(s));
    });

    return () => {
      unsubConn();
      unsubState();
      unsubCreated();
      unsubEnded();
    };
  }, []);

  const isSessionActive = session?.status === 'ACTIVE';

  return (
    <div className="min-h-screen bg-[#0F0F11] text-[#E4E4E7] flex flex-col selection:bg-white selection:text-black">
      {/* Top Navbar with live research status */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        sessionActive={isSessionActive}
        isConnected={isConnected}
      />

      {/* Main View Area */}
      <main className="flex-1 pb-12">
        {activeTab === 'teacher' && (
          <TeacherDashboard
            onOpenStudentScanner={() => setActiveTab('student')}
            onOpenSecurityLab={() => setActiveTab('security-lab')}
            onOpenCalibration={() => setActiveTab('calibration')}
          />
        )}

        {activeTab === 'student' && (
          <StudentScanner
            onOpenCalibration={() => setActiveTab('calibration')}
            onNavigateToTeacher={() => setActiveTab('teacher')}
          />
        )}

        {activeTab === 'security-lab' && <SecurityTestLab />}

        {activeTab === 'calibration' && <CameraCalibration />}

        {activeTab === 'benchmarks' && <ResearchBenchmarks />}

        {activeTab === 'threat-model' && <ThreatModelDoc />}
      </main>

      {/* Research PoC Footer with Bold Editorial Grid */}
      <footer className="border-t border-white/10 bg-[#0A0A0C] py-12 mt-auto text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-black">
                Specification
              </span>
              <span className="text-sm font-bold tracking-tight text-white">
                TQR Protocol &mdash; 2026 Academic PoC
              </span>
              <span className="text-xs text-white/50">
                Temporal Optical Signal Synchronization
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-black">
                Telemetry State
              </span>
              <span className="text-sm font-medium flex items-center gap-2 text-white">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                {isConnected ? 'Real-Time WebSocket Link Online' : 'Connecting to Server Node...'}
              </span>
              <span className="text-xs text-white/50">
                Frame Frequency: 1 &ndash; 20 QR/s
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-black">
                Cryptographic Layer
              </span>
              <span className="text-xs font-mono font-bold text-white/90">
                HMAC-SHA256 &bull; Hash-Chained Nonce
              </span>
              <span className="text-xs text-white/50">
                Anti-Replay Window: &le; 15,000 ms
              </span>
            </div>

            <div className="flex flex-col gap-2 lg:items-end">
              <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-black">
                Classification
              </span>
              <div className="text-right">
                <span className="inline-block px-2.5 py-1 bg-white/10 text-white font-mono font-bold text-[10px] tracking-wider uppercase border border-white/10">
                  Experimental Laboratory
                </span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/40 text-[11px] font-mono">
            <div>
              &copy; 2026 Temporal Dynamic QR Research Initiative. Strictly for academic simulation.
            </div>
            <div className="tracking-widest uppercase">
              Core Security Evaluation Engine
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

