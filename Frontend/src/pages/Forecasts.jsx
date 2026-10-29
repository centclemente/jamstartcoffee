import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import DatePicker from '../components/DatePicker';

const API_BASE = import.meta.env.VITE_API_URL;

if (!API_BASE) {
  throw new Error('VITE_API_URL is not configured. Set it to the deployed backend API URL.');
}

// The backend accepts 1-24 months ahead. We always fetch the maximum and let the
// "Forecast until" date decide how much of it is shown, so changing the date
// never needs another request.
const FORECAST_HORIZON_MONTHS = 24;
const DEFAULT_MONTHS_SHOWN = 3;

// API keys are retained for compatibility; the backend now serves Holt-Winters
// models for both forecast cards.
const PRETRAINED_MODELS = [
  { key: 'sarima' },
  { key: 'demand' },
];

const units = (n) => `${Number(n ?? 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })} units`;
const peso = (n) => `₱${Number(n ?? 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
const formatValue = (n, target) => (target === 'revenue' ? peso(n) : units(n));

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FORECAST_TABLE_START_MONTH = '2026-01';
const FORECAST_TABLE_START_QUARTER = '2026-Q1';

// Returns "YYYY-MM" for a month string, or null when it isn't in that format.
function monthKey(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[1]}-${match[2]}` : null;
}

function isFromForecastTableStart(value) {
  const key = monthKey(value);
  return key !== null && key >= FORECAST_TABLE_START_MONTH;
}

// "2026-07" -> "Jul 2026". Anything that isn't YYYY-MM is returned unchanged.
function formatMonthLabel(value) {
  const key = monthKey(value);
  if (!key) return value;
  const monthName = MONTH_NAMES[Number(key.slice(5)) - 1];
  return monthName ? `${monthName} ${key.slice(0, 4)}` : value;
}

function addMonths(key, count) {
  const [year, month] = key.split('-').map(Number);
  const index = year * 12 + (month - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function quarterOf(key) {
  const year = key.slice(0, 4);
  const quarter = Math.ceil(Number(key.slice(5)) / 3);
  return { id: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
}

function quarterMonthLabel(keys) {
  return [...new Set(keys)]
    .sort()
    .map((key) => MONTH_NAMES[Number(key.slice(5)) - 1])
    .join(', ');
}

function withForecastGrowth(rows, baseline = null) {
  return rows.map((row, index) => {
    const previous = index > 0 ? Number(rows[index - 1].value) : Number(baseline);
    const current = Number(row.value);
    return {
      ...row,
      growth: previous > 0 && Number.isFinite(current)
        ? ((current - previous) / previous) * 100
        : null,
    };
  });
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// View builders: turn the API response + filters into rows for the chart and tables.
// ---------------------------------------------------------------------------

function buildMonthlyView(data, target, until) {
  const field = target === 'revenue' ? 'actualRevenue' : 'actualUnits';
  const withinUntil = (month) => {
    const key = monthKey(month);
    return !until || !key || key <= until;
  };

  const forecast = (data?.forecast ?? []).filter((f) => withinUntil(f.month));
  const firstForecastKey = monthKey(forecast[0]?.month);
  const lastActual = [...(data?.history ?? [])]
    .filter((entry) => {
      const key = monthKey(entry.month);
      return key && (!firstForecastKey || key < firstForecastKey);
    })
    .sort((left, right) => monthKey(left.month).localeCompare(monthKey(right.month)))
    .at(-1);
  const lastActualValue = lastActual ? lastActual[field] : null;
  const backtests = new Map((data?.comparison ?? []).map((row) => [row.month, row.predictedValue]));

  const chartData = [
    ...(data?.history ?? [])
      .filter((h) => isFromForecastTableStart(h.month))
      .map((h) => ({
        month: formatMonthLabel(h.month),
        actualValue: h[field],
        predictedValue: backtests.get(h.month) ?? null,
      })),
    ...forecast.map((f) => ({
      month: formatMonthLabel(f.month),
      actualValue: null,
      predictedValue: f.predictedValue,
    })),
  ];

  return {
    chartData,
    forecastRows: withForecastGrowth(
      forecast
        .filter((f) => isFromForecastTableStart(f.month))
        .map((f) => ({
          key: f.month,
          label: formatMonthLabel(f.month),
          value: f.predictedValue,
          note: null,
        })),
      lastActualValue,
    ),
    comparisonRows: (data?.comparison ?? [])
      .filter((row) => isFromForecastTableStart(row.month))
      .map((row) => ({
        key: row.month,
        label: formatMonthLabel(row.month),
        actual: row.actualValue,
        predicted: row.predictedValue,
        accuracy: row.accuracyPct,
      })),
    contributionColumns: (data?.category_contribution ?? [])
      .filter((month) => withinUntil(month.month) && isFromForecastTableStart(month.month))
      .map((month) => ({
        key: month.month,
        label: formatMonthLabel(month.month),
        categories: month.categories || [],
      })),
    projectedTotal: forecast.reduce((sum, f) => sum + (f.predictedValue ?? 0), 0),
    rangeLabel: forecast.length
      ? `${formatMonthLabel(forecast[0].month)} to ${formatMonthLabel(forecast[forecast.length - 1].month)}`
      : '',
  };
}

function buildQuarterlyView(data, target, until) {
  const field = target === 'revenue' ? 'actualRevenue' : 'actualUnits';
  const withinUntil = (month) => {
    const key = monthKey(month);
    return !until || !key || key <= until;
  };

  // 1. Collect everything we know per calendar month.
  const byMonth = new Map();
  const entry = (key) => {
    if (!byMonth.has(key)) byMonth.set(key, {});
    return byMonth.get(key);
  };
  (data?.history ?? []).forEach((h) => {
    const key = monthKey(h.month);
    if (key && key >= FORECAST_TABLE_START_MONTH) entry(key).actual = h[field];
  });
  (data?.comparison ?? []).forEach((row) => {
    const key = monthKey(row.month);
    if (key && key >= FORECAST_TABLE_START_MONTH) entry(key).backtest = row.predictedValue;
  });
  const forecast = (data?.forecast ?? []).filter((f) => withinUntil(f.month));
  forecast.forEach((f) => {
    const key = monthKey(f.month);
    if (key) entry(key).forecast = f.predictedValue;
  });

  // 2. Group months into quarters (chronological).
  const quarters = new Map();
  [...byMonth.keys()].sort().forEach((key) => {
    const { id, label } = quarterOf(key);
    if (!quarters.has(id)) quarters.set(id, { id, label, entries: [] });
    quarters.get(id).entries.push({ key, ...byMonth.get(key) });
  });

  const chartData = [];
  const forecastRows = [];
  const comparisonRows = [];

  quarters.forEach(({ id, label, entries }) => {
    const includedMonths = quarterMonthLabel(entries.map((entry) => entry.key));
    const hasForecast = entries.some((e) => e.forecast != null);

    if (hasForecast) {
      // Forecast quarter. A quarter that started before the forecast did also
      // counts the actual months already recorded, so the total is the full quarter.
      const value = entries.reduce((sum, e) => sum + (e.forecast ?? e.actual ?? 0), 0);
      const covered = entries.filter((e) => e.forecast != null || e.actual != null).length;
      const includesActuals = entries.some((e) => e.forecast == null && e.actual != null);
      const notes = [];
      if (includesActuals) notes.push('incl. actuals');
      if (covered < 3) notes.push(`${covered} mo`);

      chartData.push({ month: `${label}\n${includedMonths}`, actualValue: null, predictedValue: value });
      forecastRows.push({
        key: id,
        label,
        value,
        note: notes.join(', ') || null,
      });

      const firstForecastQuarter = forecastRows[0]?.key;
      const previousActualQuarter = [...quarters.values()]
        .filter((quarter) => quarter.id < firstForecastQuarter)
        .at(-1);
      const previousActualValue = previousActualQuarter?.entries
        .filter((entry) => entry.actual != null)
        .reduce((sum, entry) => sum + entry.actual, 0) || null;
      return;
    }

    const actualEntries = entries.filter((e) => e.actual != null);
    if (!actualEntries.length) return;
    const actual = actualEntries.reduce((sum, e) => sum + e.actual, 0);
    const complete = actualEntries.length === 3 && actualEntries.every((e) => e.backtest != null);
    const predicted = complete ? actualEntries.reduce((sum, e) => sum + e.backtest, 0) : null;

    chartData.push({ month: `${label}\n${includedMonths}`, actualValue: actual, predictedValue: predicted });
    if (complete) {
      comparisonRows.push({
        key: id,
        label,
        actual,
        predicted,
        accuracy: actual > 0 ? Math.max(0, 100 - (Math.abs(actual - predicted) / actual) * 100) : null,
      });
    }
  });

  // 3. Category contribution: forecast months only, summed per quarter.
  const contributionGroups = new Map();
  (data?.category_contribution ?? [])
    .filter((month) => withinUntil(month.month))
    .forEach((month) => {
      const key = monthKey(month.month);
      if (!key) return;
      const { id, label } = quarterOf(key);
      if (!contributionGroups.has(id)) {
        contributionGroups.set(id, { id, label, months: 0, keys: [], totals: new Map() });
      }
      const group = contributionGroups.get(id);
      group.months += 1;
      group.keys.push(key);
      (month.categories || []).forEach((item) => {
        group.totals.set(item.category, (group.totals.get(item.category) ?? 0) + Number(item.amount || 0));
      });
    });

  const contributionColumns = [...contributionGroups.values()].map((group) => {
    const grand = [...group.totals.values()].reduce((sum, amount) => sum + amount, 0);
    return {
      key: group.id,
      label: group.label,
      categories: [...group.totals.entries()].map(([category, amount]) => ({
        category,
        amount,
        percentage: grand > 0 ? (amount / grand) * 100 : 0,
      })),
    };
  });

  return {
    chartData,
    forecastRows: withForecastGrowth(
      forecastRows.filter((row) => row.key >= FORECAST_TABLE_START_QUARTER),
      previousActualValue,
    ),
    comparisonRows: comparisonRows.filter((row) => row.key >= FORECAST_TABLE_START_QUARTER),
    contributionColumns: contributionColumns.filter((column) => column.key >= FORECAST_TABLE_START_QUARTER),
    projectedTotal: forecast.reduce((sum, f) => sum + (f.predictedValue ?? 0), 0),
    rangeLabel: forecast.length
      ? `${formatMonthLabel(forecast[0].month)} to ${formatMonthLabel(forecast[forecast.length - 1].month)}`
      : '',
  };
}

function buildView(data, target, granularity, until) {
  return granularity === 'quarterly'
    ? buildQuarterlyView(data, target, until)
    : buildMonthlyView(data, target, until);
}

// ---------------------------------------------------------------------------
// UI pieces
// ---------------------------------------------------------------------------

function ValueTooltip({ active, payload, label, target }) {
  if (!active || !payload?.length) return null;
  const visible = payload.filter((p) => p.value != null);
  if (!visible.length) return null;
  return (
    <div className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm shadow-sm">
      <p className="mb-1 font-medium text-emerald-950">{label}</p>
      {visible.map((p) => (
        <p key={p.dataKey} style={{ color: p.stroke }}>
          {p.name}: {formatValue(p.value, target)}
        </p>
      ))}
    </div>
  );
}

function ForecastFilters({ granularity, onGranularityChange, until, onUntilChange, minUntil, maxUntil }) {
  const wrapperClass =
    'flex items-center gap-2 rounded-2xl border border-emerald-900/10 bg-white px-3 py-2 text-sm text-emerald-950 shadow-sm shadow-emerald-950/5';

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <label className={wrapperClass}>
        <span className="text-xs text-emerald-900/55">View</span>
        <select
          value={granularity}
          onChange={(event) => onGranularityChange(event.target.value)}
          className="bg-transparent text-sm text-emerald-950 outline-none"
        >
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
      </label>

      <DatePicker
        value={until}
        min={minUntil}
        max={maxUntil}
        onChange={onUntilChange}
        mode="month"
        label="Forecast until"
      />

      {minUntil && maxUntil && (
        <span className="text-xs text-emerald-900/50">
          Available: {formatMonthLabel(minUntil)} to {formatMonthLabel(maxUntil)}
        </span>
      )}
    </div>
  );
}

function ForecastChart({ chartData, target }) {
  const tick = ({ x, y, payload }) => {
    const [period, months] = String(payload.value).split('\n');
    return (
      <g transform={`translate(${x},${y})`}>
        <text textAnchor="middle" fill="#14532d" fontSize={12}>{period}</text>
        {months && (
          <text y={15} textAnchor="middle" fill="#14532d" fontSize={10}>{months}</text>
        )}
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#d6e2db" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={tick}
          height={38}
          tickMargin={6}
          padding={{ left: 12, right: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={target === 'revenue' ? 70 : 50}
          tickFormatter={(v) => (target === 'revenue' ? peso(v) : v)}
        />
        <Tooltip content={<ValueTooltip target={target} />} />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="plainline"
          wrapperStyle={{ fontSize: 12, color: '#14532d', paddingBottom: 8 }}
        />
        <Line
          type="linear"
          dataKey="actualValue"
          name="Actual"
          stroke="#14532d"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
        <Line
          type="linear"
          dataKey="predictedValue"
          name="Forecast"
          stroke="#14532d"
          strokeWidth={2.5}
          strokeDasharray="6 6"
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ForecastTable({ forecastKey, rows, periodLabel, expanded, onToggle, target }) {
  const visibleRows = expanded ? rows : rows.slice(0, 3);
  const fmt = (n) => formatValue(n, target);
  const unitWord = periodLabel === 'Quarter' ? 'quarters' : 'months';
  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-emerald-900/10 text-left text-xs uppercase tracking-[0.2em] text-lime-700/60">
              <th className="py-2 pr-4">{periodLabel}</th>
              <th className="py-2 pr-4 text-right">Predicted</th>
              <th className="py-2 text-right">Growth</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key} className="border-b border-emerald-900/5">
                <td className="py-2 pr-4 font-medium text-emerald-950">
                  {row.label}
                  {row.note && <span className="ml-2 text-xs font-normal text-emerald-900/50">({row.note})</span>}
                </td>
                <td className="py-2 pr-4 text-right text-emerald-900/80">{fmt(row.value)}</td>
                <td className={`py-2 text-right ${row.growth == null ? 'text-emerald-900/40' : row.growth >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {row.growth == null ? '—' : `${row.growth >= 0 ? '+' : ''}${row.growth.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 3 && (
        <button
          onClick={() => onToggle(forecastKey)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-900/10 py-2 text-xs font-medium text-emerald-900/60 hover:bg-emerald-50"
        >
          {expanded ? (
            <>
              Show less <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Show all {rows.length} {unitWord} <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function ComparisonTable({ rows, periodLabel, target }) {
  if (!rows?.length) return null;
  const fmt = (n) => formatValue(n, target);
  return (
    <div className="mt-6 border-t border-emerald-900/10 pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-950">
          Actual vs predicted
        </h3>
        <span className="text-xs text-emerald-900/50">
          {periodLabel === 'Quarter' ? 'Completed quarters only' : 'Completed months only'}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-emerald-900/10 text-left text-xs uppercase tracking-[0.16em] text-lime-700/60">
              <th className="py-2 pr-4">{periodLabel}</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Predicted</th>
              <th className="px-3 py-2 text-right">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-emerald-900/5">
                <td className="py-2 pr-4 font-medium text-emerald-950">
                  {row.label}
                </td>
                <td className="px-3 py-2 text-right text-emerald-900/75">{fmt(row.actual)}</td>
                <td className="px-3 py-2 text-right text-emerald-900/75">{fmt(row.predicted)}</td>
                <td className="px-3 py-2 text-right text-emerald-900/75">
                  {row.accuracy == null ? '—' : `${row.accuracy.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Green up arrow when `current` is higher than the previous period's prediction,
// red down arrow when it is lower. Nothing is shown for the first column or
// when the value is unchanged.
function ChangeArrow({ current, previous, target, periodWord }) {
  if (previous === null || previous === undefined || current === null || current === undefined) return null;
  const now = Number(current);
  const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before) || Math.round(now) === Math.round(before)) return null;

  if (now > before) {
    return (
      <ArrowUp
        className="h-3.5 w-3.5 shrink-0 text-emerald-600"
        aria-label={`Higher than previous ${periodWord}`}
        title={`Up from ${formatValue(before, target)}`}
      />
    );
  }
  return (
    <ArrowDown
      className="h-3.5 w-3.5 shrink-0 text-rose-600"
      aria-label={`Lower than previous ${periodWord}`}
      title={`Down from ${formatValue(before, target)}`}
    />
  );
}

function CategoryContributionTable({ columns, target, periodWord }) {
  const categories = [...new Set(columns.flatMap((column) => column.categories.map((item) => item.category)))];
  if (!columns.length || !categories.length) return null;

  const findAmount = (column, category) => {
    const item = column?.categories.find((entry) => entry.category === category);
    return item ? Number(item.amount) : null;
  };
  const columnTotal = (column) =>
    column ? column.categories.reduce((sum, item) => sum + Number(item.amount || 0), 0) : null;

  return (
    <div className="mt-6 border-t border-emerald-900/10 pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-950">
          Category contribution estimate
        </h3>
        <span className="text-xs text-emerald-900/50">Last 6 months average share</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-emerald-900/10 text-left text-xs uppercase tracking-[0.16em] text-lime-700/60">
              <th className="py-2 pr-4">Category</th>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2 text-right">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category} className="border-b border-emerald-900/5">
                <td className="py-2 pr-4 font-medium text-emerald-950">{category}</td>
                {columns.map((column, index) => {
                  const item = column.categories.find((entry) => entry.category === category);
                  const previousAmount = index > 0 ? findAmount(columns[index - 1], category) : null;
                  return (
                    <td key={`${category}-${column.key}`} className="px-3 py-2 text-right text-emerald-900/75">
                      {item ? (
                        <>
                          <span className="flex items-center justify-end gap-1 font-medium">
                            <ChangeArrow current={item.amount} previous={previousAmount} target={target} periodWord={periodWord} />
                            {formatValue(item.amount, target)}
                          </span>
                          <span className="text-xs text-emerald-900/50">{item.percentage.toFixed(1)}%</span>
                        </>
                      ) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t-2 border-emerald-900/15 bg-emerald-50/60 font-semibold">
              <td className="py-2 pr-4 text-emerald-950">Total</td>
              {columns.map((column, index) => {
                const total = columnTotal(column);
                const previousTotal = index > 0 ? columnTotal(columns[index - 1]) : null;
                return (
                  <td key={`total-${column.key}`} className="px-3 py-2 text-right text-emerald-950">
                    <span className="flex items-center justify-end gap-1">
                      <ChangeArrow current={total} previous={previousTotal} target={target} periodWord={periodWord} />
                      {formatValue(total, target)}
                    </span>
                    <span className="text-xs text-emerald-900/60">100.0%</span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Chart + all tables for one forecast card.
function ForecastBody({ forecastKey, loading, error, view, target, granularity, expanded, onToggle, chartHeight, loadingText }) {
  const periodLabel = granularity === 'quarterly' ? 'Quarter' : 'Month';
  const periodWord = granularity === 'quarterly' ? 'quarter' : 'month';

  return (
    <>
      <div className={`${chartHeight} rounded-3xl border border-emerald-900/10 bg-[#fbfaf7] p-3 sm:p-4`}>
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-emerald-900/50">
            <Loader2 className="h-4 w-4 animate-spin" /> {loadingText}
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-emerald-900/60">
            <AlertCircle className="h-5 w-5" />
            <p className="max-w-xs text-sm">{error}</p>
          </div>
        ) : view.chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-emerald-900/50">
            No forecast data available.
          </div>
        ) : (
          <ForecastChart chartData={view.chartData} target={target} />
        )}
      </div>

      {!loading && !error && view.chartData.length > 0 && (
        <>
          <ForecastTable
            forecastKey={forecastKey}
            rows={view.forecastRows}
            periodLabel={periodLabel}
            expanded={expanded}
            onToggle={onToggle}
            target={target}
          />
          <ComparisonTable rows={view.comparisonRows} periodLabel={periodLabel} target={target} />
          <CategoryContributionTable columns={view.contributionColumns} target={target} periodWord={periodWord} />
        </>
      )}
    </>
  );
}

export default function Forecasts() {
  // One entry per pretrained model key -- { sarima: {...}, demand: {...} }
  const [pretrained, setPretrained] = useState({});
  const [pretrainedLoading, setPretrainedLoading] = useState({});
  const [pretrainedError, setPretrainedError] = useState({});
  const [expandedTables, setExpandedTables] = useState({});

  // Filters (shared by both forecast cards)
  const [granularity, setGranularity] = useState('monthly');
  const [untilInput, setUntilInput] = useState(''); // '' = use the default until the user picks a date

  const toggleTable = (key) => {
    setExpandedTables((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const loadPretrained = async (key) => {
    setPretrainedLoading((prev) => ({ ...prev, [key]: true }));
    setPretrainedError((prev) => ({ ...prev, [key]: null }));
    try {
      const params = new URLSearchParams({ monthsAhead: FORECAST_HORIZON_MONTHS });
      const data = await fetchJSON(`${API_BASE}/analytics/forecast-pretrained/${key}?${params}`);
      setPretrained((prev) => ({ ...prev, [key]: data }));
    } catch (err) {
      setPretrained((prev) => ({ ...prev, [key]: null }));
      setPretrainedError((prev) => ({ ...prev, [key]: err.message }));
    } finally {
      setPretrainedLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  useEffect(() => {
    PRETRAINED_MODELS.forEach((m) => loadPretrained(m.key));
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleSalesDataChanged = () => {
      PRETRAINED_MODELS.forEach((m) => loadPretrained(m.key));
    };

    window.addEventListener('sales-data-changed', handleSalesDataChanged);
    return () => window.removeEventListener('sales-data-changed', handleSalesDataChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- "Forecast until" bounds come from the latest month that has real sales ---
  const lastActualMonth = useMemo(() => {
    const history = pretrained.sarima?.history ?? pretrained.demand?.history ?? [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const key = monthKey(history[i].month);
      if (key) return key;
    }
    return null;
  }, [pretrained]);

  const minUntil = lastActualMonth ? addMonths(lastActualMonth, 1) : '';
  const maxUntil = lastActualMonth ? addMonths(lastActualMonth, FORECAST_HORIZON_MONTHS) : '';

  const until = useMemo(() => {
    if (!lastActualMonth) return '';
    const picked = untilInput || addMonths(lastActualMonth, DEFAULT_MONTHS_SHOWN);
    if (picked < minUntil) return minUntil;
    if (picked > maxUntil) return maxUntil;
    return picked;
  }, [untilInput, lastActualMonth, minUntil, maxUntil]);

  // --- Sales forecast -- the primary panel ---
  const salesData = pretrained.sarima;
  const salesTarget = salesData?.target ?? 'units';
  const salesView = useMemo(
    () => buildView(salesData, salesTarget, granularity, until),
    [salesData, salesTarget, granularity, until]
  );

  // --- Demand forecast -- secondary panel ---
  const demandModel = PRETRAINED_MODELS.find((m) => m.key === 'demand');
  const demandData = pretrained.demand;
  const demandTarget = demandData?.target ?? 'units';
  const demandView = useMemo(
    () => buildView(demandData, demandTarget, granularity, until),
    [demandData, demandTarget, granularity, until]
  );

  const refreshButtonClass =
    'flex h-9 w-9 items-center justify-center rounded-full border border-emerald-900/10 text-emerald-900/60 hover:bg-emerald-50';

  return (
    <section className="grid gap-6">
      {/* Header + filters */}
      <div className="rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-6 sm:p-8">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">Forecasts</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-emerald-950 sm:text-4xl">
           FORECASTS
          </h1>
        </div>

        <ForecastFilters
          granularity={granularity}
          onGranularityChange={setGranularity}
          until={until}
          onUntilChange={setUntilInput}
          minUntil={minUntil}
          maxUntil={maxUntil}
        />
      </div>

      {/* Sales forecast chart */}
      <div className="rounded-[1.5rem] border border-emerald-900/10 bg-white p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-emerald-950">
                Forecasted Gross sales
              </h2>
            </div>
          </div>
          <button onClick={() => loadPretrained('sarima')} className={refreshButtonClass} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6">
          <ForecastBody
            forecastKey="sarima"
            loading={pretrainedLoading.sarima}
            error={pretrainedError.sarima}
            view={salesView}
            target={salesTarget}
            granularity={granularity}
            expanded={!!expandedTables.sarima}
            onToggle={toggleTable}
            chartHeight="h-80"
            loadingText="Loading forecast…"
          />
        </div>
      </div>

      {/* Demand forecast */}
      <div className="rounded-[1.5rem] border border-emerald-900/10 bg-white p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime-100 text-lime-900">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-emerald-950">
                Forecasted Units Sold
              </h2>
            </div>
          </div>
          <button onClick={() => loadPretrained(demandModel.key)} className={refreshButtonClass} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-4 text-2xl font-semibold text-emerald-950">
          {pretrainedLoading.demand ? '—' : formatValue(demandView.projectedTotal, demandTarget)}
        </p>
        <p className="mt-1 text-sm text-emerald-900/65">
          {demandView.rangeLabel ? `Projected total, ${demandView.rangeLabel}` : 'Projected total'}
        </p>

        <div className="mt-5">
          <ForecastBody
            forecastKey="demand"
            loading={pretrainedLoading.demand}
            error={pretrainedError.demand}
            view={demandView}
            target={demandTarget}
            granularity={granularity}
            expanded={!!expandedTables.demand}
            onToggle={toggleTable}
            chartHeight="h-64"
            loadingText="Loading…"
          />
        </div>
      </div>
    </section>
  );
}