import React from 'react';
import {
  ShieldAlert,
  GraduationCap,
  ScanLine,
  ShieldCheck,
  Activity,
  BarChart3,
  BookOpen,
} from 'lucide-react';

export type NavTab =
  | 'teacher'
  | 'student'
  | 'security-lab'
  | 'calibration'
  | 'benchmarks'
  | 'threat-model';

interface NavbarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  sessionActive: boolean;
  isConnected: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  sessionActive,
  isConnected,
}) => {
  const navItems: { id: NavTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'teacher',
      label: 'Teacher Console',
      icon: <GraduationCap className="w-3.5 h-3.5" />,
      badge: sessionActive ? (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
      ) : undefined,
    },
    {
      id: 'student',
      label: 'Student Scanner',
      icon: <ScanLine className="w-3.5 h-3.5" />,
    },
    {
      id: 'security-lab',
      label: 'Replay Lab',
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
    },
    {
      id: 'calibration',
      label: 'Calibration',
      icon: <Activity className="w-3.5 h-3.5" />,
    },
    {
      id: 'benchmarks',
      label: 'Benchmarks',
      icon: <BarChart3 className="w-3.5 h-3.5" />,
    },
    {
      id: 'threat-model',
      label: 'Threat Model',
      icon: <BookOpen className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <header className="border-b border-white/10 bg-[#0F0F11]/90 backdrop-blur-md sticky top-0 z-40 select-none">
      {/* Research Disclaimer Top Header Bar */}
      <div className="bg-[#141417] border-b border-white/5 px-4 sm:px-8 py-2 text-xs flex flex-wrap items-center justify-between gap-3 text-white/60">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="font-bold text-white/90">RESEARCH TESTBED:</span>
          <span>Optical Frame Chaining & Replay Mitigation</span>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono tracking-widest uppercase">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className={isConnected ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              {isConnected ? 'LIVE WS CONNECTED' : 'WS RECONNECTING'}
            </span>
          </div>
          <span className="text-white/20">|</span>
          <div className="text-white/70">
            Pass: <code className="bg-white/10 text-white px-1.5 py-0.5 rounded font-bold font-mono">research2026</code>
          </div>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
          {/* Logo / Brand with Bold Typography */}
          <div
            id="nav-logo"
            onClick={() => onSelectTab('teacher')}
            className="flex items-center gap-3 cursor-pointer group py-2"
          >
            <div className="w-9 h-9 bg-white text-black flex items-center justify-center font-black tracking-tighter text-sm rounded-none shadow-sm transition-transform group-hover:scale-95">
              TQR
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-white text-base tracking-tight uppercase">
                  TEMPORAL<span className="text-white/40">.QR</span>
                </span>
                <span className="text-[9px] font-mono font-bold tracking-[0.2em] uppercase px-1.5 py-0.5 bg-white/10 text-white/80 border border-white/10">
                  EXP-V1
                </span>
              </div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                Optical Anti-Replay Verification
              </p>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="flex items-center gap-1 sm:gap-2 overflow-x-auto py-2">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`tab-${item.id}-btn`}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-white text-black shadow-md font-black'
                      : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};

