import React from 'react';
import {
  BookOpen,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Layers,
  Cpu,
  Eye,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export const ThreatModelDoc: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      {/* Header */}
      <div className="border-b border-white/10 pb-8 mb-8 relative">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[10px] font-bold tracking-[0.35em] uppercase text-white/40">
            Module 06 // Security Specifications
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-black tracking-[-0.04em] uppercase text-white leading-[0.9]">
          THREAT MODEL & <span className="text-stroke-subtle text-transparent">PHYSICS.</span>
        </h1>

        <div className="flex items-center gap-4 mt-3">
          <div className="w-12 h-[1px] bg-white/20"></div>
          <p className="font-serif-italic text-sm sm:text-base text-white/60">
            Formal cryptographic security analysis, adversary capabilities, and optical channel physical constraints.
          </p>
        </div>
      </div>

      <div className="space-y-8 text-white/80 text-sm">
        {/* 1. Research Objective & System Hypothesis */}
        <section className="bg-[#151518] border border-white/10 p-6 sm:p-8 shadow-sm space-y-3">
          <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white flex items-center gap-2 pb-3 border-b border-white/10">
            <Eye className="w-4 h-4 text-white" />
            <span>1. Core Empirical Hypothesis</span>
          </h2>
          <p className="text-xs text-white/70 font-serif-italic leading-relaxed">
            Conventional classroom attendance schemes depend on static 2D barcodes, rendering them inherently susceptible to remote proxy fraud via screenshot forwarding or prerecorded playback. This investigation validates whether a <strong className="text-white">temporally dynamic optical QR sequence</strong>—operating at 4 to 12 QR/sec with cryptographic hash chaining and synchronous timestamp bounds—can render asynchronous proxy cheating mathematically and empirically infeasible.
          </p>
        </section>

        {/* 2. Supported Threat Matrix */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Protected Vectors */}
          <div className="bg-[#151518] border border-emerald-500/30 p-6 sm:p-8 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-emerald-400 pb-3 border-b border-white/10">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xs font-black uppercase tracking-[0.2em]">Mitigated Replay Threats</h2>
            </div>

            <ul className="space-y-3.5 text-xs text-white/60 font-serif-italic">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Static Screenshot Sharing
                  </strong>
                  A single image supplies only $1$ optical frame. The server enforces a mandatory chain of $N \ge 3$ sequentially incrementing frames.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Cross-Session Token Reuse
                  </strong>
                  Session nonces and cryptographic identifiers rotate per session. Stale QR payloads are rejected.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Prerecorded Video Replay
                  </strong>
                  Video recordings played outside the active emission window fail strict real-time timestamp freshness validation ($\Delta t \le 15$s).
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Sequence Splicing & Forgery
                  </strong>
                  SHA-256 recursive hash chaining (<code>H_k = Hash(H_(k-1) || k)</code>) prevents arbitrary frame reordering or injection.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Payload Metadata Tampering
                  </strong>
                  Server-side HMAC-SHA256 authentication tag verification immediately detects altered counters or manipulated timing headers.
                </div>
              </li>
            </ul>
          </div>

          {/* Remaining Limits / Out of Scope */}
          <div className="bg-[#151518] border border-amber-500/30 p-6 sm:p-8 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-amber-400 pb-3 border-b border-white/10">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h2 className="text-xs font-black uppercase tracking-[0.2em]">Known Physical Boundaries</h2>
            </div>

            <ul className="space-y-3.5 text-xs text-white/60 font-serif-italic">
              <li className="flex items-start gap-2.5">
                <XCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Ultra-Low-Latency Video Relay
                  </strong>
                  An accomplice streaming live video via WebRTC with $&lt;100$ms latency could allow remote scanning. Optical jitter and client challenges mitigate but do not fully eliminate high-bandwidth live relays without multi-modal proximity sensing.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <XCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Display Refresh & Shutter Limits
                  </strong>
                  Standard 60Hz displays and 30FPS rolling-shutter cameras encounter exposure tearing and frame drop if emission frequency exceeds ~12–15 QR/s.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <XCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white font-sans uppercase font-bold text-[11px] block not-italic">
                    Hardware Driver Virtualization
                  </strong>
                  Rooted devices with virtual camera drivers capable of injecting synthetic image buffers directly into browser APIs are outside the optical layer's perimeter.
                </div>
              </li>
            </ul>
          </div>
        </section>

        {/* 3. Physical Optical Channel Engineering */}
        <section className="bg-[#151518] border border-white/10 p-6 sm:p-8 shadow-sm space-y-5">
          <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white flex items-center gap-2 pb-3 border-b border-white/10">
            <Cpu className="w-4 h-4 text-white" />
            <span>3. Optical Channel Sampling Physics</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-4 bg-[#0F0F11] border border-white/10">
              <div className="text-white/40 uppercase text-[9px] tracking-widest">Optimal Frame Period</div>
              <div className="text-lg font-black text-white mt-1">83 – 125 MS</div>
              <div className="text-white/40 text-[10px] mt-0.5">8 to 12 QR / Sec</div>
            </div>
            <div className="p-4 bg-[#0F0F11] border border-white/10">
              <div className="text-white/40 uppercase text-[9px] tracking-widest">Camera Oversampling</div>
              <div className="text-lg font-black text-white mt-1">4× – 6× FRAMES</div>
              <div className="text-white/40 text-[10px] mt-0.5">At 60 FPS Sensor</div>
            </div>
            <div className="p-4 bg-[#0F0F11] border border-white/10">
              <div className="text-white/40 uppercase text-[9px] tracking-widest">ECC Level</div>
              <div className="text-lg font-black text-white mt-1">LEVEL L (7%)</div>
              <div className="text-white/40 text-[10px] mt-0.5">Maximizes Module Size</div>
            </div>
          </div>

          <p className="text-xs text-white/60 font-serif-italic leading-relaxed">
            By choosing Low ('L') QR error correction and a compact serialized syntax (<code>V1~sid~seq~ts~dur~mode~prevHash~sig</code>), the generated matrix remains at Version 2–3 density (25×25 to 29×29 modules). This keeps individual modules large and sharply contrasted on projector screens, minimizing camera autofocus delay and motion blur.
          </p>
        </section>

        {/* 4. PoC Scope Notice */}
        <section className="bg-[#0F0F11] border border-white/10 p-6 text-xs text-white/60 space-y-2">
          <div className="font-bold text-white font-mono uppercase tracking-wider text-[11px]">
            Academic Proof-of-Concept Disclosure
          </div>
          <p className="font-serif-italic leading-relaxed">
            This platform serves as an academic experimental testbed for evaluating optical channel properties and replay resistance. In accordance with the research specifications, teacher authentication uses an intentional demonstrative passphrase (<code>research2026</code>) and student identities are user-entered strings. Production deployment would integrate institutional SSO/OAuth and hardware security modules.
          </p>
        </section>
      </div>
    </div>
  );
};
