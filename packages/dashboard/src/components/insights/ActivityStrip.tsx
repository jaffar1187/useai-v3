import { useMemo, useState } from 'react';
import type { SessionSeal } from '../../lib/api';
import { getDailyActivity, getDailyActivityAI, getHourlyActivity, getHourlyActivityAI } from '../../lib/stats';
import type { TimeScale } from '../time-travel/types';
import { motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';

type TimeMode = 'user' | 'ai';

const TIME_LABELS: Record<TimeMode, string> = {
  user: 'Clock Time',
  ai: 'AI Time',
};

function formatTime(hours: number): string {
  const totalMins = Math.round(hours * 60);
  if (totalMins < 1) return '<1m';
  if (totalMins < 60) return `${totalMins}m`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

interface ActivityStripProps {
  sessions: SessionSeal[];
  timeScale: TimeScale;
  effectiveTime: number;
  isLive: boolean;
  onDayClick?: (date: string) => void;
  highlightDate?: string;
}

export function ActivityStrip({
  sessions,
  timeScale,
  effectiveTime,
  isLive: _isLive,
  onDayClick,
  highlightDate,
}: ActivityStripProps) {
  const [timeMode, setTimeMode] = useState<TimeMode>('user');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const useHourly = timeScale === 'day' || timeScale === '24h' || timeScale === '12h' || timeScale === '6h';
  const ed = new Date(effectiveTime);
  const effectiveDate = `${ed.getFullYear()}-${String(ed.getMonth() + 1).padStart(2, '0')}-${String(ed.getDate()).padStart(2, '0')}`;

  const hourlyData = useMemo(
    () => (useHourly ? (timeMode === 'user' ? getHourlyActivity(sessions, effectiveDate) : getHourlyActivityAI(sessions, effectiveDate)) : []),
    [sessions, effectiveDate, useHourly, timeMode],
  );

  const dailyData = useMemo(
    () => (useHourly ? [] : (timeMode === 'user' ? getDailyActivity(sessions, 7) : getDailyActivityAI(sessions, 7))),
    [sessions, useHourly, timeMode],
  );

  const title = useHourly
    ? `Hourly — ${new Date(effectiveTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
    : 'Last 7 Days';

  const dropdown = (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/50 bg-bg-surface-2 text-[11px] text-text-secondary font-medium hover:border-text-muted/50 transition-colors"
      >
        {TIME_LABELS[timeMode]}
        <ChevronDown className="w-3 h-3 text-text-muted" />
      </button>
      {dropdownOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[120px] rounded-lg border border-border/50 bg-bg-surface-1 shadow-lg py-1">
            {(Object.entries(TIME_LABELS) as [TimeMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => { setTimeMode(mode); setDropdownOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  mode === timeMode
                    ? 'text-accent bg-accent/10 font-medium'
                    : 'text-text-secondary hover:bg-bg-surface-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  if (useHourly) {
    const maxMinutes = Math.max(...hourlyData.map((d) => d.minutes), 1);

    return (
      <div className="mb-8 p-5 rounded-2xl bg-bg-surface-1/50 border border-border/50">
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="text-xs text-text-muted uppercase tracking-widest font-bold">
            {title}
          </div>
          {dropdown}
        </div>
        <div className="flex items-end gap-[3px] h-16">
          {hourlyData.map((entry, idx) => {
            const heightPct = maxMinutes > 0 ? (entry.minutes / maxMinutes) * 100 : 0;
            return (
              <div
                key={entry.hour}
                className="flex-1 flex flex-col items-center justify-end h-full group relative"
              >
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
                  <div className="bg-bg-surface-3 text-text-primary text-[10px] font-mono px-2 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-border flex flex-col items-center">
                    <span className="font-bold">{entry.hour}:00</span>
                    <span className="text-accent">{entry.minutes.toFixed(0)}m active</span>
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-bg-surface-3 border-r border-b border-border rotate-45" />
                  </div>
                </div>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(heightPct, entry.minutes > 0 ? 8 : 0)}%` }}
                  transition={{ delay: idx * 0.01, duration: 0.5 }}
                  className="w-full rounded-t-sm transition-all duration-300 group-hover:bg-accent relative overflow-hidden"
                  style={{
                    minHeight: entry.minutes > 0 ? '4px' : '0px',
                    backgroundColor:
                      entry.minutes > 0
                        ? `rgba(var(--accent-rgb), ${0.4 + (entry.minutes / maxMinutes) * 0.6})`
                        : 'var(--color-bg-surface-2)',
                  }}
                >
                  {entry.minutes > (maxMinutes * 0.5) && (
                    <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/10" />
                  )}
                </motion.div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-[3px] mt-2 border-t border-border/30 pt-2">
          {hourlyData.map((entry) => (
            <div key={entry.hour} className="flex-1 text-center">
              {entry.hour % 6 === 0 && (
                <span className="text-[9px] text-text-muted font-bold font-mono uppercase">
                  {entry.hour === 0 ? '12am' : entry.hour < 12 ? `${entry.hour}am` : entry.hour === 12 ? '12pm' : `${entry.hour - 12}pm`}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Daily mode (7 days)
  const maxHours = Math.max(...dailyData.map((d) => d.hours), 0.1);

  return (
    <div className="mb-8 p-5 rounded-2xl bg-bg-surface-1/50 border border-border/50">
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="text-xs text-text-muted uppercase tracking-widest font-bold">
          {title}
        </div>
        {dropdown}
      </div>
      <div className="flex items-end gap-2 h-16">
        {dailyData.map((day, idx) => {
          const heightPct = maxHours > 0 ? (day.hours / maxHours) * 100 : 0;
          const isHighlighted = day.date === highlightDate;
          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
                <div className="bg-bg-surface-3 text-text-primary text-[10px] font-mono px-2 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-border flex flex-col items-center">
                  <span className="font-bold">{day.date}</span>
                  <span className="text-accent">{formatTime(day.hours)} active</span>
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-bg-surface-3 border-r border-b border-border rotate-45" />
                </div>
              </div>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(heightPct, day.hours > 0 ? 8 : 0)}%` }}
                transition={{ delay: idx * 0.05, duration: 0.5 }}
                className={`w-full rounded-t-md cursor-pointer transition-all duration-300 group-hover:scale-x-110 origin-bottom ${isHighlighted ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-base' : ''}`}
                style={{
                  minHeight: day.hours > 0 ? '4px' : '0px',
                  backgroundColor: isHighlighted
                    ? 'var(--color-accent-bright)'
                    : day.hours > 0
                      ? `rgba(var(--accent-rgb), ${0.4 + (day.hours / maxHours) * 0.6})`
                      : 'var(--color-bg-surface-2)',
                }}
                onClick={() => onDayClick?.(day.date)}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-2 border-t border-border/30 pt-2">
        {dailyData.map((day) => (
          <div key={day.date} className="flex-1 text-center">
            <span className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">
              {new Date(day.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
