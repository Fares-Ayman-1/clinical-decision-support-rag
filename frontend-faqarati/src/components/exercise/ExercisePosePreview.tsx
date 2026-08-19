/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLanguage } from "../../LanguageContext";

export type PoseKind = "spine" | "squat" | "neck" | "shoulder" | "generic";

export function inferPoseKind(exerciseId: string): PoseKind {
  const id = exerciseId.toLowerCase();
  if (id.includes("spine") || id.includes("lumbar") || id === "ex-spine") return "spine";
  if (id.includes("knee") || id.includes("squat") || id === "ex-squat") return "squat";
  if (id.includes("cerv") || id.includes("neck") || id === "ex-neck") return "neck";
  if (id.includes("shoulder") || id === "ex-shoulder") return "shoulder";
  return "generic";
}

interface ExercisePosePreviewProps {
  exerciseId: string;
  kimoreMin?: number;
  kimoreMax?: number;
  compact?: boolean;
}

export default function ExercisePosePreview({
  exerciseId,
  kimoreMin = 90,
  kimoreMax = 120,
  compact = false,
}: ExercisePosePreviewProps) {
  const { t } = useLanguage();
  const kind = inferPoseKind(exerciseId);
  const h = compact ? "h-14" : "h-24";

  return (
    <div className={`relative w-full ${h} bg-slate-950 rounded-xl border border-slate-800 overflow-hidden`}>
      <svg viewBox="0 0 160 100" className="w-full h-full" aria-hidden>
        <defs>
          <linearGradient id="poseGlow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0d9488" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <rect width="160" height="100" fill="url(#poseGlow)" />
        {/* floor */}
        <ellipse cx="80" cy="92" rx="40" ry="4" fill="#334155" opacity="0.5" />

        {kind === "spine" && (
          <g stroke="#e2e8f0" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <circle cx="80" cy="22" r="7" fill="#94a3b8" stroke="none" />
            <path d="M80 29 L80 55 L72 75 L68 88" />
            <path d="M80 55 L88 75 L92 88" />
            <path d="M80 40 L95 48" stroke="#2dd4bf" strokeWidth="3" />
            <path d="M80 40 L65 48" stroke="#2dd4bf" strokeWidth="3" />
            <path d="M55 35 Q80 18 105 35" stroke="#fbbf24" strokeWidth="2" strokeDasharray="4 3" />
            <text x="108" y="32" fill="#fbbf24" fontSize="7" fontFamily="monospace">
              {kimoreMin}°-{kimoreMax}°
            </text>
          </g>
        )}

        {kind === "squat" && (
          <g stroke="#e2e8f0" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <circle cx="80" cy="18" r="6" fill="#94a3b8" stroke="none" />
            <path d="M80 24 L80 48" />
            <path d="M80 48 L65 68 L62 88" />
            <path d="M80 48 L95 68 L98 88" />
            <path d="M65 68 L95 68" stroke="#fbbf24" strokeWidth="2" strokeDasharray="3 2" />
            <path d="M62 70 Q65 55 80 50" stroke="#2dd4bf" strokeWidth="2.5" />
            <text x="100" y="58" fill="#fbbf24" fontSize="7" fontFamily="monospace">
              {kimoreMin}°-{kimoreMax}°
            </text>
          </g>
        )}

        {kind === "neck" && (
          <g stroke="#e2e8f0" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <circle cx="88" cy="28" r="7" fill="#94a3b8" stroke="none" />
            <path d="M80 35 L80 70 L75 88" />
            <path d="M80 70 L85 88" />
            <path d="M80 35 L70 30" stroke="#2dd4bf" strokeWidth="3" />
            <path d="M88 28 L98 32" stroke="#fbbf24" strokeWidth="2" />
            <text x="102" y="34" fill="#fbbf24" fontSize="7" fontFamily="monospace">
              {kimoreMin}°-{kimoreMax}°
            </text>
          </g>
        )}

        {kind === "shoulder" && (
          <g stroke="#e2e8f0" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <circle cx="80" cy="22" r="7" fill="#94a3b8" stroke="none" />
            <path d="M80 29 L80 58 L76 88" />
            <path d="M80 58 L84 88" />
            <path d="M80 38 L55 42 L48 55" stroke="#2dd4bf" strokeWidth="3" />
            <path d="M80 38 L105 42 L112 55" stroke="#2dd4bf" strokeWidth="3" />
            <text x="114" y="48" fill="#fbbf24" fontSize="7" fontFamily="monospace">
              {kimoreMin}°-{kimoreMax}°
            </text>
          </g>
        )}

        {kind === "generic" && (
          <g stroke="#e2e8f0" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <circle cx="80" cy="22" r="7" fill="#94a3b8" stroke="none" />
            <path d="M80 29 L80 58 L72 88" />
            <path d="M80 58 L88 88" />
            <circle cx="80" cy="45" r="12" stroke="#2dd4bf" strokeWidth="2" fill="none" opacity="0.6" />
          </g>
        )}
      </svg>
      <span className="absolute bottom-1 left-2 text-[8px] font-mono text-teal-400/90 uppercase tracking-wide">
        {t("معاينة الحركة", "Motion preview")}
      </span>
    </div>
  );
}
