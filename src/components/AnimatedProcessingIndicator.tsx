import React from 'react';

export interface AnimatedProcessingIndicatorProps {
  message: string;
  secondaryMessage?: string;
  progress?: number;
}

export const AnimatedProcessingIndicator: React.FC<AnimatedProcessingIndicatorProps> = ({
  message,
  secondaryMessage,
  progress,
}) => {
  return (
    <div className="processing-indicator-container" role="alert" aria-live="polite">
      <style>{`
        .processing-indicator-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 30px 20px;
          margin: 20px auto;
          max-width: 100%;
        }

        .processing-animation-wrapper {
          position: relative;
          width: 220px;
          height: 220px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Responsive sizing */
        @media (max-width: 900px) {
          .processing-animation-wrapper {
            width: 180px;
            height: 180px;
            margin-bottom: 18px;
          }
        }
        @media (max-width: 600px) {
          .processing-animation-wrapper {
            width: 140px;
            height: 140px;
            margin-bottom: 14px;
          }
        }

        .processing-text-primary {
          font-size: 1.15rem;
          font-weight: 600;
          color: var(--accent, #0f6b6b);
          margin-bottom: 8px;
          max-width: 600px;
          line-height: 1.4;
        }

        .processing-text-secondary {
          font-size: 0.9rem;
          color: var(--muted, #5a6a7e);
          max-width: 500px;
          line-height: 1.45;
        }

        /* SVG Animation Keyframes */
        @keyframes rotate-slow {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes rotate-reverse {
          0% { transform: rotate(360deg); }
          100% { transform: rotate(0deg); }
        }

        @keyframes pulse-glow {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.15); opacity: 0.8; }
        }

        @keyframes pulse-core {
          0%, 100% { transform: scale(0.95); filter: drop-shadow(0 0 4px rgba(15,107,107,0.4)); }
          50% { transform: scale(1.05); filter: drop-shadow(0 0 12px rgba(15,107,107,0.8)); }
        }

        @keyframes flow-dash {
          0% { stroke-dashoffset: 24; }
          100% { stroke-dashoffset: 0; }
        }

        @keyframes orbit-p {
          0% { transform: translate(0, 0); }
          50% { transform: translate(6px, -8px); }
          100% { transform: translate(0, 0); }
        }

        @keyframes orbit-i {
          0% { transform: translate(0, 0); }
          50% { transform: translate(-8px, 6px); }
          100% { transform: translate(0, 0); }
        }

        @keyframes orbit-c {
          0% { transform: translate(0, 0); }
          50% { transform: translate(8px, 8px); }
          100% { transform: translate(0, 0); }
        }

        @keyframes orbit-o {
          0% { transform: translate(0, 0); }
          50% { transform: translate(-6px, -6px); }
          100% { transform: translate(0, 0); }
        }

        .anim-rotate {
          animation: rotate-slow 20s linear infinite;
          transform-origin: center;
        }

        .anim-rotate-rev {
          animation: rotate-reverse 15s linear infinite;
          transform-origin: center;
        }

        .anim-pulse-glow {
          animation: pulse-glow 3s ease-in-out infinite;
          transform-origin: center;
        }

        .anim-pulse-core {
          animation: pulse-core 2s ease-in-out infinite;
          transform-origin: center;
        }

        .anim-flow {
          animation: flow-dash 1.5s linear infinite;
        }

        .anim-node-p {
          animation: orbit-p 4s ease-in-out infinite;
          transform-origin: center;
        }
        .anim-node-i {
          animation: orbit-i 4.5s ease-in-out infinite;
          transform-origin: center;
        }
        .anim-node-c {
          animation: orbit-c 5s ease-in-out infinite;
          transform-origin: center;
        }
        .anim-node-o {
          animation: orbit-o 3.5s ease-in-out infinite;
          transform-origin: center;
        }

        /* Accessibility: prefers-reduced-motion support */
        @media (prefers-reduced-motion: reduce) {
          .anim-rotate, .anim-rotate-rev, .anim-pulse-glow, .anim-pulse-core, .anim-flow,
          .anim-node-p, .anim-node-i, .anim-node-c, .anim-node-o {
            animation: none !important;
            transform: none !important;
          }
          .anim-pulse-glow {
            opacity: 0.5 !important;
          }
        }
      `}</style>

      <div className="processing-animation-wrapper">
        <svg viewBox="0 0 200 200" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Background Radial Glow */}
          <circle cx="100" cy="100" r="70" fill="url(#radialGlow)" className="anim-pulse-glow" />

          {/* Outer Orbital Ring */}
          <circle cx="100" cy="100" r="85" stroke="#edf5f5" strokeWidth="2" strokeDasharray="5 5" />
          
          {/* Inner Flowing Ring */}
          <circle cx="100" cy="100" r="65" stroke="var(--accent, #0f6b6b)" strokeWidth="1.5" strokeOpacity="0.25" />
          <circle cx="100" cy="100" r="65" stroke="var(--accent, #0f6b6b)" strokeWidth="2" strokeDasharray="12 12" className="anim-rotate anim-flow" strokeLinecap="round" />

          {/* Connecting Evidence Network Lines */}
          <g stroke="var(--accent, #0f6b6b)" strokeWidth="1" strokeOpacity="0.3" className="anim-rotate-rev">
            <line x1="100" y1="100" x2="50" y2="60" />
            <line x1="100" y1="100" x2="150" y2="60" />
            <line x1="100" y1="100" x2="140" y2="145" />
            <line x1="100" y1="100" x2="60" y2="140" />
            <line x1="50" y1="60" x2="150" y2="60" />
            <line x1="150" y1="60" x2="140" y2="145" />
            <line x1="140" y1="145" x2="60" y2="140" />
            <line x1="60" y1="140" x2="50" y2="60" />
          </g>

          {/* Connected Active Evidence Nodes (Orbiting/Floating) */}
          {/* P — Population Node (top-left) */}
          <g className="anim-node-p">
            <circle cx="50" cy="60" r="14" fill="#fff" stroke="var(--accent, #0f6b6b)" strokeWidth="1.5" />
            <circle cx="50" cy="60" r="10" fill="var(--accent-light, #e3f2f2)" />
            <text x="50" y="64" fontSize="11" fontWeight="bold" fill="var(--accent, #0f6b6b)" textAnchor="middle">P</text>
          </g>

          {/* I — Intervention Node (top-right) */}
          <g className="anim-node-i">
            <circle cx="150" cy="60" r="14" fill="#fff" stroke="var(--accent, #0f6b6b)" strokeWidth="1.5" />
            <circle cx="150" cy="60" r="10" fill="var(--accent-light, #e3f2f2)" />
            <text x="150" y="64" fontSize="11" fontWeight="bold" fill="var(--accent, #0f6b6b)" textAnchor="middle">I</text>
          </g>

          {/* C — Comparator Node (bottom-right) */}
          <g className="anim-node-c">
            <circle cx="140" cy="145" r="14" fill="#fff" stroke="var(--accent, #0f6b6b)" strokeWidth="1.5" />
            <circle cx="140" cy="145" r="10" fill="var(--accent-light, #e3f2f2)" />
            <text x="140" y="149" fontSize="11" fontWeight="bold" fill="var(--accent, #0f6b6b)" textAnchor="middle">C</text>
          </g>

          {/* O — Outcome Node (bottom-left) */}
          <g className="anim-node-o">
            <circle cx="60" cy="140" r="14" fill="#fff" stroke="var(--accent, #0f6b6b)" strokeWidth="1.5" />
            <circle cx="60" cy="140" r="10" fill="var(--accent-light, #e3f2f2)" />
            <text x="60" y="144" fontSize="11" fontWeight="bold" fill="var(--accent, #0f6b6b)" textAnchor="middle">O</text>
          </g>

          {/* Rotating Data Flow Particles */}
          <g className="anim-rotate" strokeWidth="3" strokeLinecap="round">
            <circle cx="100" cy="100" r="40" stroke="var(--accent, #0f6b6b)" strokeDasharray="1 100" strokeOpacity="0.8" />
            <circle cx="100" cy="100" r="50" stroke="var(--accent, #0f6b6b)" strokeDasharray="1 150" strokeOpacity="0.6" />
          </g>

          {/* Central Processor Node (AI Core) */}
          <g className="anim-pulse-core">
            <circle cx="100" cy="100" r="24" fill="#fff" stroke="var(--accent, #0f6b6b)" strokeWidth="2.5" />
            <circle cx="100" cy="100" r="18" fill="var(--accent, #0f6b6b)" />
            {/* Glowing inner dot */}
            <circle cx="100" cy="100" r="6" fill="#fff" />
          </g>

          {/* Gradient Definitions */}
          <defs>
            <radialGradient id="radialGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--accent, #0f6b6b)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--accent, #0f6b6b)" stopOpacity="0" />
            </radialGradient>
          </defs>
        </svg>
      </div>

      {/* Dynamic Status Messages */}
      <h2 className="processing-text-primary">{message}</h2>
      {secondaryMessage && <p className="processing-text-secondary">{secondaryMessage}</p>}

      {/* Optional Progress Bar */}
      {typeof progress === 'number' && (
        <div style={{ marginTop: 16, width: '100%', maxWidth: '280px' }}>
          <div className="bar-bg" style={{ height: 6 }}>
            <div className="bar" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}></div>
          </div>
        </div>
      )}
    </div>
  );
};
