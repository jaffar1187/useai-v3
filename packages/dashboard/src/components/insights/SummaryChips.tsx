import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Monitor, Code2 } from 'lucide-react';
import type { ComputedStats } from '../../lib/stats';
import { TOOL_COLORS, TOOL_DISPLAY_NAMES } from '../../constants/tools';

interface SummaryChipsProps {
  stats: ComputedStats;
}

const LANG_COLORS = [
  '#22d3ee',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#fbbf24',
  '#34d399',
  '#f87171',
  '#fb923c',
];

const OTHER_COLOR = '#64748b';

interface Segment {
  name: string;
  displayName: string;
  seconds: number;
  color: string;
  percentage: number;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return '<1m';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = (seconds / 3600).toFixed(1);
  return `${h}h`;
}

function buildSegments(
  data: Record<string, number>,
  colors: readonly string[],
  displayNames?: Record<string, string>,
): Segment[] {
  const entries = Object.entries(data)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return [];

  const total = entries.reduce((sum, [, s]) => sum + s, 0);
  const MAX_SLICES = 6;

  let visible: [string, number][];
  let otherSeconds = 0;

  if (entries.length <= MAX_SLICES) {
    visible = entries;
  } else {
    visible = entries.slice(0, MAX_SLICES);
    otherSeconds = entries.slice(MAX_SLICES).reduce((sum, [, s]) => sum + s, 0);
  }

  const result: Segment[] = visible.map(([name, seconds], i) => ({
    name,
    displayName: displayNames?.[name] ?? name,
    seconds,
    color: colors[i % colors.length]!,
    percentage: (seconds / total) * 100,
  }));

  if (otherSeconds > 0) {
    result.push({
      name: 'Other',
      displayName: 'Other',
      seconds: otherSeconds,
      color: OTHER_COLOR,
      percentage: (otherSeconds / total) * 100,
    });
  }

  return result;
}

function DonutCard({
  title,
  icon,
  segments,
  centerLabel,
}: {
  title: string;
  icon: React.ReactNode;
  segments: Segment[];
  centerLabel: string;
}) {
  const size = 100;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 36;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;

  let accumulated = 0;
  const arcs = segments.map((seg) => {
    const dashLength = (seg.percentage / 100) * circumference;
    const gap = circumference - dashLength;
    const offset = -accumulated + circumference * 0.25;
    accumulated += dashLength;
    return { ...seg, dashLength, gap, offset };
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-xl bg-bg-surface-1 border border-border/50 p-4"
    >
      <div className="flex items-center gap-2 mb-4 px-1">
        <div className="p-1.5 rounded-lg bg-bg-surface-2">
          {icon}
        </div>
        <h2 className="text-sm font-bold text-text-muted uppercase tracking-widest">
          {title}
        </h2>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
              cx={cx} cy={cy} r={radius}
              fill="none"
              stroke="var(--color-bg-surface-2, #1e293b)"
              strokeWidth={strokeWidth}
              opacity={0.3}
            />
            {arcs.map((arc, i) => (
              <motion.circle
                key={arc.name}
                cx={cx} cy={cy} r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${arc.dashLength} ${arc.gap}`}
                strokeDashoffset={arc.offset}
                strokeLinecap="butt"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-text-primary leading-none">
              {segments.length}
            </span>
            <span className="text-[10px] text-text-muted mt-0.5">{centerLabel}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-1.5 w-full">
          {segments.map((seg, i) => (
            <motion.div
              key={seg.name}
              className="flex items-center gap-2.5"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.15 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="text-xs text-text-secondary font-medium truncate flex-1 min-w-0">
                {seg.displayName}
              </span>
              <span className="text-[10px] text-text-muted font-mono shrink-0">
                {formatTime(seg.seconds)}
              </span>
              <span className="text-[10px] text-text-muted/70 font-mono w-10 text-right shrink-0">
                {seg.percentage.toFixed(0)}%
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function SummaryChips({ stats }: SummaryChipsProps) {
  const clientSegments = useMemo(
    () => buildSegments(stats.byClient, Object.values(TOOL_COLORS), TOOL_DISPLAY_NAMES),
    [stats.byClient],
  );

  const langSegments = useMemo(
    () => buildSegments(stats.byLanguage, LANG_COLORS),
    [stats.byLanguage],
  );

  if (clientSegments.length === 0 && langSegments.length === 0) return null;

  return (
    <>
      {clientSegments.length > 0 && (
        <DonutCard
          title="Clients"
          icon={<Monitor className="w-3.5 h-3.5 text-text-muted" />}
          segments={clientSegments}
          centerLabel={clientSegments.length === 1 ? 'client' : 'clients'}
        />
      )}
      {langSegments.length > 0 && (
        <DonutCard
          title="Languages"
          icon={<Code2 className="w-3.5 h-3.5 text-text-muted" />}
          segments={langSegments}
          centerLabel={langSegments.length === 1 ? 'language' : 'languages'}
        />
      )}
    </>
  );
}
