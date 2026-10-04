import { useEffect, useMemo, useState } from 'react';
import {
  Area,
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
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const MONTH_OPTIONS = [3, 6, 12];

// key -> display label + copy for the two pretrained models. Matches the
// "key" values forecast_service.py's PRETRAINED_MODEL_META expects
// ("sarima", "demand").
const PRETRAINED_MODELS = [
  {
    key: 'sarima',
    label: 'Gross sales forecast',
    eyebrow: 'Pretrained model',
  },
  {
    key: 'demand',
    label: 'Demand forecast',
    eyebrow: 'Pretrained model',
  },
];

const units = (n) => `${Number(n ?? 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })} units`;
const peso = (n) => `₱${Number(n ?? 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
const formatValue = (n, target) => (target === 'revenue' ? peso(n) : units(n));

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// Custom tooltip so we can hide the "range" series instead of relying on
// a formatter returning null (inconsistent across Recharts versions).
function ValueTooltip({ active, payload, label, target }) {
  if (!active || !payload?.length) return null;
  const visible = payload.filter((p) => p.dataKey !== 'range' && p.value != null);
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

// Combines a model's history + forecast into one array Recharts can plot,
// with "actualValue" (solid line) transitioning into "predictedValue"
// (dashed line). Picks actualRevenue vs actualUnits from history depending
// on what this model's forecast scale actually represents -- plotting the
// wrong one is what made the actual line look flat before. Bridges the gap
// by carrying the last actual value into the first forecast point, so the
// two lines connect instead of leaving a visible break between them.
function buildChartSeries(history, forecast, target, historyWindow = 6) {
  const historyField = target === 'revenue' ? 'actualRevenue' : 'actualUnits';
  const recentHistory = (history ?? []).slice(-historyWindow);
  const historyRows = recentHistory.map((h) => ({
    month: h.month,
    actualValue: h[historyField],
    predictedValue: null,
    range: null,
  }));
  if (historyRows.length) {
    historyRows[historyRows.length - 1].predictedValue =
      historyRows[historyRows.length - 1].actualValue;
  }
  const forecastRows = (forecast ?? []).map((f) => ({
    month: f.month,
    actualValue: null,
    predictedValue: f.predictedValue,
    range: [f.lowerBound, f.upperBound],
  }));
  return [...historyRows, ...forecastRows];
}

function ForecastChart({ chartData, target }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#d6e2db" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
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
        <Area
          dataKey="range"
          stroke="none"
          fill="#14532d"
          fillOpacity={0.12}
          name="Confidence range"
          legendType="none"
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

function ForecastTable({ forecastKey, forecast, expanded, onToggle, target }) {
  const rows = expanded ? forecast : forecast.slice(0, 3);
  const fmt = (n) => formatValue(n, target);
  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-emerald-900/10 text-left text-xs uppercase tracking-[0.2em] text-lime-700/60">
              <th className="py-2 pr-4">Month</th>
              <th className="py-2 pr-4 text-right">Predicted</th>
              <th className="py-2 pl-4 text-right">Range</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.month} className="border-b border-emerald-900/5">
                <td className="py-2 pr-4 font-medium text-emerald-950">{f.month}</td>
                <td className="py-2 pr-4 text-right text-emerald-900/80">{fmt(f.predictedValue)}</td>
                <td className="py-2 pl-4 text-right text-emerald-900/60">
                  {fmt(f.lowerBound)}–{fmt(f.upperBound)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {forecast.length > 3 && (
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
              Show all {forecast.length} months <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default function Forecasts() {
  // One entry per pretrained model key -- { sarima: {...}, demand: {...} }
  const [pretrained, setPretrained] = useState({});
  const [pretrainedLoading, setPretrainedLoading] = useState({});
  const [pretrainedError, setPretrainedError] = useState({});
  const [expandedTables, setExpandedTables] = useState({});
  const [pretrainedMonthsAhead, setPretrainedMonthsAhead] = useState(
    () => Object.fromEntries(PRETRAINED_MODELS.map((m) => [m.key, 3]))
  );

  const toggleTable = (key) => {
    setExpandedTables((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const loadPretrained = async (key, months = pretrainedMonthsAhead[key]) => {
    setPretrainedLoading((prev) => ({ ...prev, [key]: true }));
    setPretrainedError((prev) => ({ ...prev, [key]: null }));
    try {
      const params = new URLSearchParams({ monthsAhead: months });
      const data = await fetchJSON(`${API_BASE}/analytics/forecast-pretrained/${key}?${params}`);
      setPretrained((prev) => ({ ...prev, [key]: data }));
    } catch (err) {
      setPretrained((prev) => ({ ...prev, [key]: null }));
      setPretrainedError((prev) => ({ ...prev, [key]: err.message }));
    } finally {
      setPretrainedLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handlePretrainedMonthsChange = (key, months) => {
    setPretrainedMonthsAhead((prev) => ({ ...prev, [key]: months }));
    loadPretrained(key, months);
  };

  useEffect(() => {
    PRETRAINED_MODELS.forEach((m) => loadPretrained(m.key, pretrainedMonthsAhead[m.key]));
    // Runs once on mount -- per-card filter changes call loadPretrained directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Sales forecast (sarima) -- the primary panel, with its own summary card ---
  const salesData = pretrained.sarima;
  const salesLoading = pretrainedLoading.sarima;
  const salesError = pretrainedError.sarima;
  const salesMonthsAhead = pretrainedMonthsAhead.sarima;
  const salesTarget = salesData?.target ?? 'units';

  const salesChartData = useMemo(
    () => buildChartSeries(salesData?.history, salesData?.forecast, salesTarget),
    [salesData, salesTarget]
  );

  // --- Demand forecast -- secondary panel ---
  const demandModel = PRETRAINED_MODELS.find((m) => m.key === 'demand');

  return (
    <section className="grid gap-6">
      {/* Header */}
      <div className="rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-6 sm:p-8">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">Forecasts</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-emerald-950 sm:text-4xl">
            Gross sales forecast
          </h1>
        </div>
      </div>

      {/* Sales forecast chart (sarima model) */}
      <div className="rounded-[1.5rem] border border-emerald-900/10 bg-white p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
                <BrainCircuit className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-lime-700/60">Pretrained model</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-emerald-950">
                  Gross sales forecast
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl border border-emerald-900/10 bg-[#fbfaf7] p-1">
                {MONTH_OPTIONS.map((m) => (
                  <button
                    key={m}
                    onClick={() => handlePretrainedMonthsChange('sarima', m)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      salesMonthsAhead === m
                        ? 'bg-emerald-950 text-white'
                        : 'text-emerald-900/60 hover:bg-emerald-50'
                    }`}
                  >
                    {m}mo
                  </button>
                ))}
              </div>
              <button
                onClick={() => loadPretrained('sarima')}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-900/10 text-emerald-900/60 hover:bg-emerald-50"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-6 h-80 rounded-3xl border border-emerald-900/10 bg-[#fbfaf7] p-3 sm:p-4">
            {salesLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-emerald-900/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading forecast…
              </div>
            ) : salesError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-emerald-900/60">
                <AlertCircle className="h-5 w-5" />
                <p className="max-w-xs text-sm">{salesError}</p>
              </div>
            ) : salesChartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-emerald-900/50">
                No forecast data available.
              </div>
            ) : (
              <ForecastChart chartData={salesChartData} target={salesTarget} />
            )}
          </div>

          {!salesLoading && !salesError && salesChartData.length > 0 && (
            <ForecastTable
              forecastKey="sarima"
              forecast={salesData.forecast}
              expanded={!!expandedTables.sarima}
              onToggle={toggleTable}
              target={salesTarget}
            />
          )}
      </div>

      {/* Demand forecast */}
      <div className="rounded-[1.5rem] border border-emerald-900/10 bg-white p-6 sm:p-8">
        {(() => {
          const key = demandModel.key;
          const data = pretrained[key];
          const loading = pretrainedLoading[key];
          const error = pretrainedError[key];
          const months = pretrainedMonthsAhead[key];

          const target = data?.target ?? 'units';
          const chartData = buildChartSeries(data?.history, data?.forecast, target);

          const totalValue = (data?.forecast ?? []).reduce(
            (sum, f) => sum + (f.predictedValue ?? 0),
            0
          );

          return (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime-100 text-lime-900">
                    <BrainCircuit className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-lime-700/60">
                      {demandModel.eyebrow}
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-tight text-emerald-950">
                      {demandModel.label}
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-emerald-900/10 bg-[#fbfaf7] p-1">
                    {MONTH_OPTIONS.map((m) => (
                      <button
                        key={m}
                        onClick={() => handlePretrainedMonthsChange(key, m)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          months === m
                            ? 'bg-emerald-950 text-white'
                            : 'text-emerald-900/60 hover:bg-emerald-50'
                        }`}
                      >
                        {m}mo
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => loadPretrained(key)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-900/10 text-emerald-900/60 hover:bg-emerald-50"
                    title="Refresh"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <p className="mt-4 text-2xl font-semibold text-emerald-950">
                {loading ? '—' : formatValue(totalValue, target)}
              </p>
              <p className="mt-1 text-sm text-emerald-900/65">
                Projected total, next {months} months
              </p>

              <div className="mt-5 h-64 rounded-3xl border border-emerald-900/10 bg-[#fbfaf7] p-3 sm:p-4">
                {loading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-emerald-900/50">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : error ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-emerald-900/60">
                    <AlertCircle className="h-5 w-5" />
                    <p className="max-w-xs text-sm">{error}</p>
                  </div>
                ) : chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-emerald-900/50">
                    No forecast data available.
                  </div>
                ) : (
                  <ForecastChart chartData={chartData} target={target} />
                )}
              </div>

              {!loading && !error && chartData.length > 0 && (
                <ForecastTable
                  forecastKey={key}
                  forecast={data.forecast}
                  expanded={!!expandedTables[key]}
                  onToggle={toggleTable}
                  target={target}
                />
              )}
            </>
          );
        })()}
      </div>
    </section>
  );
}