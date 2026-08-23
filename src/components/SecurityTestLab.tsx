import React, { useState } from 'react';
import { runSecurityTest } from '../utils/network';
import {
  ShieldCheck,
  ShieldAlert,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  Bug,
  RefreshCw,
  Terminal,
} from 'lucide-react';

interface SecurityTestCase {
  id: string;
  name: string;
  category: string;
  description: string;
  expectedOutcome: 'REJECTED' | 'ACCEPTED';
  attackType: string;
}

const TEST_CASES: SecurityTestCase[] = [
  {
    id: 'attack-1',
    name: 'Attack 1: Static Screenshot Replay',
    category: 'Spatial Capture',
    description:
      'Attacker captures a single photo/screenshot of the teacher dynamic QR and attempts authentication with 1 frame.',
    expectedOutcome: 'REJECTED',
    attackType: 'ATTACK_1_SCREENSHOT',
  },
  {
    id: 'attack-2',
    name: 'Attack 2: Old Session Frame Reuse',
    category: 'Cross-Session Replay',
    description:
      'Attacker attempts to submit valid temporal frames captured from yesterday or an expired session ID.',
    expectedOutcome: 'REJECTED',
    attackType: 'ATTACK_2_OLD_SESSION_QR',
  },
  {
    id: 'attack-3',
    name: 'Attack 3: Pre-recorded Video Replay',
    category: 'Temporal Delay',
    description:
      'Attacker records a valid 5-second video of the screen and attempts playback 10 minutes later to authenticate an absent proxy.',
    expectedOutcome: 'REJECTED',
    attackType: 'ATTACK_3_RECORDED_VIDEO_STALE',
  },
  {
    id: 'attack-4',
    name: 'Attack 4: Reordered Frame Injection',
    category: 'Sequence Tampering',
    description:
      'Attacker sniffs frames and reorders sequence (e.g. Frame 104 -> Frame 102 -> Frame 105) to bypass monotonic verification.',
    expectedOutcome: 'REJECTED',
    attackType: 'ATTACK_4_REORDERED_FRAMES',
  },
  {
    id: 'attack-5',
    name: 'Attack 5: Modified QR Payload Tampering',
    category: 'Cryptographic Forgery',
    description:
      'Attacker alters sequence number or duration bits inside the optical string without valid HMAC session secret.',
    expectedOutcome: 'REJECTED',
    attackType: 'ATTACK_5_MODIFIED_PAYLOAD',
  },
  {
    id: 'attack-6',
    name: 'Attack 6: Expired Session Submission',
    category: 'Lifecycle Violation',
    description:
      'Student completes scanning and submits after the teacher-configured session timer has expired.',
    expectedOutcome: 'REJECTED',
    attackType: 'ATTACK_6_EXPIRED_SESSION',
  },
  {
    id: 'attack-7',
    name: 'Attack 7: Duplicate Identity Resubmission',
    category: 'Identity Fraud',
    description:
      'Same student attempts to submit multiple attendance proofs or register multiple times in one session.',
    expectedOutcome: 'REJECTED',
    attackType: 'ATTACK_7_DUPLICATE_SUBMISSION',
  },
  {
    id: 'control-baseline',
    name: 'Control Baseline: Live Valid Stream',
    category: 'Control Group',
    description:
      'Legitimate student observing live dynamic optical signal in real-time with continuous frame chaining and HMAC tags.',
    expectedOutcome: 'ACCEPTED',
    attackType: 'BENCHMARK_VALID_LIVE',
  },
];

export const SecurityTestLab: React.FC = () => {
  const [testResults, setTestResults] = useState<
    Record<
      string,
      {
        blocked: boolean;
        verdict: string;
        code: string;
        message: string;
        framesTested?: number;
      }
    >
  >({});
  const [isRunningAll, setIsRunningAll] = useState<boolean>(false);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);

  const executeTest = async (testCase: SecurityTestCase) => {
    setRunningTestId(testCase.id);
    try {
      const res = await runSecurityTest(testCase.attackType, `Attacker_${testCase.id}`);
      setTestResults((prev) => ({
        ...prev,
        [testCase.id]: res,
      }));
    } catch (e: any) {
      setTestResults((prev) => ({
        ...prev,
        [testCase.id]: {
          blocked: true,
          verdict: 'NETWORK_ERROR',
          code: 'NETWORK_ERROR',
          message: e.message,
        },
      }));
    }
    setRunningTestId(null);
  };

  const handleRunAllTests = async () => {
    setIsRunningAll(true);
    for (const testCase of TEST_CASES) {
      await executeTest(testCase);
    }
    setIsRunningAll(false);
  };

  const totalTests = TEST_CASES.length;
  const executedCount = Object.keys(testResults).length;
  const passedCount = Object.entries(testResults).filter(([id, r]: [string, any]) => {
    const testCase = TEST_CASES.find((t) => t.id === id);
    if (!testCase) return false;
    if (testCase.expectedOutcome === 'REJECTED') {
      return r.blocked === true;
    } else {
      return r.blocked === false;
    }
  }).length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      {/* Top Banner */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/10 pb-8 mb-8 relative">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[10px] font-bold tracking-[0.35em] uppercase text-white/40">
              Module 03 // Attack Simulation Harness
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-black tracking-[-0.04em] uppercase text-white leading-[0.9]">
            SECURITY <span className="text-stroke-subtle text-transparent">TEST LAB.</span>
          </h1>

          <div className="flex items-center gap-4 mt-3">
            <div className="w-12 h-[1px] bg-white/20"></div>
            <p className="font-serif-italic text-sm sm:text-base text-white/60">
              Automated adversarial test harness validating replay resistance across 7 optical attack vectors.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="run-all-security-tests-btn"
            onClick={handleRunAllTests}
            disabled={isRunningAll}
            className="px-6 py-3.5 bg-white hover:bg-zinc-200 text-black font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center gap-2.5 disabled:opacity-50"
          >
            {isRunningAll ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isRunningAll ? 'EXECUTING SUITE...' : 'RUN FULL TEST SUITE'}</span>
          </button>
        </div>
      </div>

      {/* Summary Scorecard */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-[#151518] border border-white/10 p-6 shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold text-white/40 uppercase tracking-[0.25em]">
            Vectors Executed
          </div>
          <div className="text-3xl font-black text-white font-mono mt-2">
            {executedCount} <span className="text-base text-white/40">/ {totalTests}</span>
          </div>
        </div>

        <div className="bg-[#151518] border border-white/10 p-6 shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold text-white/40 uppercase tracking-[0.25em]">
            Threats Neutralized
          </div>
          <div className="text-3xl font-black text-emerald-400 font-mono mt-2">
            {passedCount} <span className="text-base text-white/40">/ {executedCount || totalTests}</span>
          </div>
        </div>

        <div className="bg-[#151518] border border-white/10 p-6 shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold text-white/40 uppercase tracking-[0.25em]">
            Empirical Efficacy
          </div>
          <div className="text-3xl font-black text-white font-mono mt-2">
            {executedCount > 0 ? `${((passedCount / executedCount) * 100).toFixed(0)}%` : 'ARMED'}
          </div>
        </div>
      </div>

      {/* Test Cases Grid */}
      <div className="space-y-4">
        {TEST_CASES.map((tc) => {
          const res = testResults[tc.id];
          const isPending = runningTestId === tc.id;
          const isPassed =
            res && (tc.expectedOutcome === 'REJECTED' ? res.blocked : !res.blocked);

          return (
            <div
              key={tc.id}
              className={`bg-[#151518] border p-6 transition-all ${
                res
                  ? isPassed
                    ? 'border-emerald-500/40 bg-[#151518]'
                    : 'border-rose-500/50 bg-[#151518]'
                  : 'border-white/10 hover:border-white/20'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 border border-white/15 bg-white/5 text-white/70">
                      {tc.category}
                    </span>
                    <h3 className="text-sm font-black uppercase tracking-wider text-white">
                      {tc.name}
                    </h3>
                  </div>
                  <p className="text-xs text-white/60 font-serif-italic leading-relaxed">
                    {tc.description}
                  </p>
                </div>

                <div className="flex items-center gap-3 self-start md:self-auto">
                  {res ? (
                    <div className="text-right font-mono text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 font-bold text-[11px] uppercase tracking-wider border ${
                          isPassed
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                            : 'bg-rose-950/60 text-rose-300 border-rose-500/40'
                        }`}
                      >
                        {isPassed ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{tc.expectedOutcome === 'REJECTED' ? 'BLOCKED' : 'ACCEPTED'}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5" />
                            <span>VULNERABLE</span>
                          </>
                        )}
                      </span>
                    </div>
                  ) : null}

                  <button
                    onClick={() => executeTest(tc)}
                    disabled={isPending || isRunningAll}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/90 text-xs font-mono font-bold uppercase tracking-wider border border-white/15 transition-colors flex items-center gap-2 disabled:opacity-40"
                  >
                    {isPending ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3 fill-current" />
                    )}
                    <span>RUN VECTOR</span>
                  </button>
                </div>
              </div>

              {/* Result Diagnostics */}
              {res && (
                <div className="mt-4 pt-4 border-t border-white/10 font-mono text-xs space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-white/40 uppercase tracking-wider text-[10px]">
                      Diagnostic Verification Signal:
                    </span>
                    <code className="text-white font-bold bg-[#0F0F11] px-2.5 py-0.5 border border-white/10 text-[11px]">
                      {res.code}
                    </code>
                  </div>
                  <p className="text-white/60 text-xs font-serif-italic">{res.message}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
