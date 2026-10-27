import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function monthKey(year, month) {
  return `${year}-${pad(month + 1)}`;
}

function parseValue(value, mode) {
  if (!value) return null;
  const match = mode === 'month' ? /^(\d{4})-(\d{2})$/.exec(value) : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: mode === 'month' ? 1 : Number(match[3]) };
}

function formatValue(date, mode) {
  const value = monthKey(date.year, date.month);
  return mode === 'month' ? value : `${value}-${pad(date.day)}`;
}

function formatLabel(value, mode) {
  const date = parseValue(value, mode);
  if (!date) return mode === 'month' ? 'Select month' : 'Select date';
  if (mode === 'month') return `${MONTH_NAMES[date.month].slice(0, 3)} ${date.year}`;
  return new Date(date.year, date.month, date.day).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function compareValues(left, right) {
  return left.localeCompare(right);
}

function shiftMonth(date, amount) {
  const next = new Date(date.year, date.month + amount, 1);
  return { year: next.getFullYear(), month: next.getMonth(), day: 1 };
}

export default function DatePicker({ value, onChange, min, max, mode = 'date', label, disabled = false }) {
  const pickerRef = useRef(null);
  const selected = parseValue(value, mode);
  const minDate = parseValue(min, mode);
  const maxDate = parseValue(max, mode);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(selected || minDate || { year: new Date().getFullYear(), month: new Date().getMonth(), day: 1 });

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (selected) setView(selected);
  }, [value]); // Keep the visible calendar aligned after a parent reset.

  const viewKey = monthKey(view.year, view.month);
  const canGoPrevious = !minDate || viewKey > monthKey(minDate.year, minDate.month);
  const canGoNext = !maxDate || viewKey < monthKey(maxDate.year, maxDate.month);

  const days = useMemo(() => {
    if (mode === 'month') return [];
    const firstDay = new Date(view.year, view.month, 1).getDay();
    const count = new Date(view.year, view.month + 1, 0).getDate();
    return Array.from({ length: firstDay + count }, (_, index) => {
      if (index < firstDay) return null;
      return { year: view.year, month: view.month, day: index - firstDay + 1 };
    });
  }, [mode, view]);

  const isDisabled = (candidate) => {
    const candidateValue = formatValue(candidate, mode);
    return (min && compareValues(candidateValue, min) < 0) || (max && compareValues(candidateValue, max) > 0);
  };

  const choose = (candidate) => {
    if (isDisabled(candidate)) return;
    onChange(formatValue(candidate, mode));
    setOpen(false);
  };

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex min-w-[9.5rem] items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm shadow-sm transition ${
          disabled
            ? 'cursor-not-allowed border-emerald-900/10 bg-emerald-50/50 text-emerald-900/40'
            : 'border-emerald-900/10 bg-white text-emerald-950 hover:border-emerald-700/30 hover:bg-emerald-50/40'
        }`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-emerald-700/70" />
        <span className="min-w-0">
          {label && <span className="mr-1 text-xs text-emerald-900/50">{label}</span>}
          <span className="font-medium">{formatLabel(value, mode)}</span>
        </span>
      </button>

      {open && !disabled && (
        <div className="absolute left-0 z-30 mt-2 w-[19rem] rounded-3xl border border-emerald-900/10 bg-[#fbfaf7] p-4 shadow-xl shadow-emerald-950/15">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => canGoPrevious && setView(shiftMonth(view, -1))}
              disabled={!canGoPrevious}
              className="rounded-xl p-2 text-emerald-900/70 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold text-emerald-950">
              {MONTH_NAMES[view.month]} {view.year}
            </p>
            <button
              type="button"
              onClick={() => canGoNext && setView(shiftMonth(view, 1))}
              disabled={!canGoNext}
              className="rounded-xl p-2 text-emerald-900/70 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {mode === 'month' ? (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {MONTH_NAMES.map((name, month) => {
                const candidate = { year: view.year, month, day: 1 };
                const candidateValue = formatValue(candidate, mode);
                const active = candidateValue === value;
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={isDisabled(candidate)}
                    onClick={() => choose(candidate)}
                    className={`rounded-xl px-2 py-2 text-xs font-medium transition ${
                      active
                        ? 'bg-emerald-950 text-white'
                        : 'text-emerald-900/75 hover:bg-emerald-100 hover:text-emerald-950'
                    } disabled:cursor-not-allowed disabled:opacity-25`}
                  >
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-900/45">
                {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {days.map((candidate, index) => {
                  if (!candidate) return <span key={`empty-${index}`} />;
                  const candidateValue = formatValue(candidate, mode);
                  const active = candidateValue === value;
                  return (
                    <button
                      key={candidateValue}
                      type="button"
                      disabled={isDisabled(candidate)}
                      onClick={() => choose(candidate)}
                      className={`h-8 rounded-lg text-xs font-medium transition ${
                        active
                          ? 'bg-emerald-950 text-white'
                          : 'text-emerald-900/75 hover:bg-emerald-100 hover:text-emerald-950'
                      } disabled:cursor-not-allowed disabled:opacity-25`}
                    >
                      {candidate.day}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
