import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Lightbulb, Package, RefreshCcw, Sparkles, Wallet } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { fetchCategoryBreakdown, fetchKpiSummary, fetchSalesTrend, fetchTopItems } from '../api/analytics';
import DatePicker from '../components/DatePicker';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });

const monthFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: 'numeric',
});

// Earliest date the dashboard will ever look back to (only a search floor, not a limit on your data).
const DATA_START_FLOOR = '2000-01-01';

function formatDateInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

// "All time" runs from the first month that has sales data (`earliest`, YYYY-MM-DD) to today.
function getAllTimeRange(earliest) {
  return { from: earliest || DATA_START_FLOOR, to: formatDateInput(new Date()) };
}

function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

function formatMonth(value) {
  return monthFormatter.format(new Date(value));
}

function formatDateLabel(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPct(value) {
  return `${Math.abs(value).toFixed(1)}%`;
}

/** Adds month-over-month growth (%) to each row of a monthly series. */
function withGrowth(data, key) {
  return data.map((entry, index) => {
    const previous = index > 0 ? data[index - 1][key] : null;
    const growth = previous && previous > 0 ? ((entry[key] - previous) / previous) * 100 : null;
    return { month: entry.month, value: entry[key], growth };
  });
}

/**
 * Builds a short insight for a monthly series. The first sentence says what the
 * chart/table shows, then peak and slowest month vs. the average of the selected range.
 */
function buildTrendInsight(data, key, formatter, measure, scope) {
  if (!data || data.length === 0) return null;

  if (data.length === 1) {
    return `This chart and table show the ${measure}${scope} for ${data[0].month}, which was ${formatter(data[0][key])}. Only one month has data in this filter, so there is nothing to compare yet; widen the date range to see peak and slow months.`;
  }

  const intro = `This chart and table show the ${measure}${scope} for each month from ${data[0].month} to ${data[data.length - 1].month}.`;

  const total = data.reduce((sum, entry) => sum + entry[key], 0);
  const average = total / data.length;
  if (average === 0) return `${intro} No ${measure} were recorded in this range.`;

  const peak = data.reduce((best, entry) => (entry[key] > best[key] ? entry : best), data[0]);
  const slow = data.reduce((worst, entry) => (entry[key] < worst[key] ? entry : worst), data[0]);

  if (peak[key] === slow[key]) {
    return `${intro} The ${measure} were the same every month at ${formatter(average)}.`;
  }

  const peakPct = ((peak[key] - average) / average) * 100;
  const slowPct = ((slow[key] - average) / average) * 100;

  return (
    `${intro} ${peak.month} was the peak month at ${formatter(peak[key])}, ${formatPct(peakPct)} above the monthly average of ${formatter(average)}. ` +
    `${slow.month} was the slowest at ${formatter(slow[key])}, ${formatPct(slowPct)} ${slowPct < 0 ? 'below' : 'above'} the average.`
  );
}

function buildItemsInsight(items, mode, rangeLabel, scope) {
  if (!items || items.length === 0) return null;

  const label = mode === 'top' ? 'top-selling' : 'lowest-selling';
  const intro = `This chart ranks the ${items.length} ${label} items${scope} by revenue from ${rangeLabel}.`;
  const average = items.reduce((sum, item) => sum + item.revenue, 0) / items.length;
  const first = items[0];

  if (items.length === 1 || average === 0) {
    return `${intro} ${first.itemName} is first with ${formatCurrency(first.revenue)} from ${formatNumber(first.unitsSold)} units.`;
  }

  const pct = ((first.revenue - average) / average) * 100;
  return (
    `${intro} ${first.itemName} is first with ${formatCurrency(first.revenue)} from ${formatNumber(first.unitsSold)} units, ` +
    `${formatPct(pct)} ${pct >= 0 ? 'above' : 'below'} the average of ${formatCurrency(average)} across the items shown.`
  );
}

const PREVIEW_ROWS = 3;

function GrowthCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-emerald-900/40">N/A</span>;
  }
  const positive = value >= 0;
  return (
    <span className={`font-medium ${positive ? 'text-emerald-700' : 'text-rose-600'}`}>
      {positive ? '+' : '-'}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function TrendTable({ rows, valueLabel, formatValue }) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, PREVIEW_ROWS);
  const hiddenCount = rows.length - PREVIEW_ROWS;

  return (
    <div className="mt-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="border-b border-emerald-900/10 text-left text-xs uppercase tracking-[0.2em] text-lime-700/80">
              <th className="py-3 pr-4 font-semibold">Month</th>
              <th className="px-4 py-3 text-right font-semibold">{valueLabel}</th>
              <th className="py-3 pl-4 text-right font-semibold">Growth (%)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.month} className="border-b border-emerald-900/10 last:border-0">
                <td className="py-3 pr-4 font-medium text-emerald-950">{row.month}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-800">{formatValue(row.value)}</td>
                <td className="py-3 pl-4 text-right">
                  <GrowthCell value={row.growth} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="mt-3 rounded-xl border border-emerald-900/10 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-emerald-900/60 transition hover:bg-emerald-50 hover:text-emerald-950"
        >
          {showAll ? 'Show less' : `Show all (${rows.length})`}
        </button>
      )}
    </div>
  );
}

function SectionCard({ title, children, className = '' }) {
  return (
    <section className={`rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-sm shadow-emerald-950/5 sm:p-6 ${className}`}>
      <div className="border-b border-emerald-900/10 pb-4">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-lime-700/80">{title}</p>
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}

function Insight({ text }) {
  if (!text) return null;
  return (
    <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-900/10 bg-white px-4 py-3">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-lime-700" />
      <p className="text-sm leading-6 text-emerald-950/80">{text}</p>
    </div>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="flex min-h-[18rem] items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-900/10 bg-white px-6 py-10 text-center">
      <div className="max-w-md">
        <p className="text-base font-medium text-emerald-950">{title}</p>
        {description && <p className="mt-2 text-sm leading-6 text-emerald-900/60">{description}</p>}
      </div>
    </div>
  );
}

function LoadingState({ message, height = 'min-h-[22rem]' }) {
  return (
    <div className={`flex ${height} items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-900/10 bg-white text-sm text-emerald-900/55`}>
      {message}
    </div>
  );
}

function KpiStatCard({ icon, label, value, sublabel, loading, error }) {
  return (
    <div className="rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-sm shadow-emerald-950/5 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">{label}</p>
          {error ? (
            <p className="mt-1 text-sm text-rose-600">{error}</p>
          ) : loading ? (
            <p className="mt-1 text-lg font-semibold text-emerald-900/40">Loading...</p>
          ) : (
            <p className="mt-1 truncate text-2xl font-semibold text-emerald-950">{value}</p>
          )}
        </div>
      </div>
      {!error && !loading && sublabel && <p className="mt-3 text-sm text-emerald-900/55">{sublabel}</p>}
    </div>
  );
}

export default function Dashboard() {
  // ---- General filters (apply to every card and chart) ----
  const [range, setRange] = useState(() => getAllTimeRange());
  const [dateMode, setDateMode] = useState('all'); // 'all' = All time, 'custom' = pick From/To
  const [ready, setReady] = useState(false); // true once we know where the data starts
  const earliestRef = useRef(null);
  const isCustomRangeRef = useRef(false); // true once the user edits the dates by hand
  const [category, setCategory] = useState('all');
  const [categoryOptions, setCategoryOptions] = useState([{ label: 'All categories', value: 'all' }]);
  const { from, to } = range;

  // Only the top/least toggle stays local to the items card (it is a view mode, not a filter).
  const [itemMode, setItemMode] = useState('top');

  const [trendData, setTrendData] = useState([]);
  const [topItemsData, setTopItemsData] = useState([]);
  const [kpiData, setKpiData] = useState(null);

  const [trendLoading, setTrendLoading] = useState(true);
  const [topItemsLoading, setTopItemsLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [trendError, setTrendError] = useState('');
  const [topItemsError, setTopItemsError] = useState('');
  const [kpiError, setKpiError] = useState('');

  const overviewRequestRef = useRef(0);
  const itemsRequestRef = useRef(0);

  const handleDateModeChange = (mode) => {
    setDateMode(mode);
    if (mode === 'all') {
      isCustomRangeRef.current = false;
      setRange(getAllTimeRange(earliestRef.current));
    }
  };

  const handleFromChange = (value) => {
    if (!value) return;
    isCustomRangeRef.current = true;
    setDateMode('custom');
    setRange((current) => ({ from: value, to: value > current.to ? value : current.to }));
  };

  const handleToChange = (value) => {
    if (!value) return;
    isCustomRangeRef.current = true;
    setDateMode('custom');
    setRange((current) => ({ from: value < current.from ? value : current.from, to: value }));
  };

  const handleReset = () => {
    handleDateModeChange('all');
    setCategory('all');
  };

  // "All time" starts at the first month that has data, not a fixed date.
  useEffect(() => {
    let isActive = true;

    fetchSalesTrend(DATA_START_FLOOR, formatDateInput(new Date()))
      .then((result) => {
        if (!isActive) return;
        const first = (result?.trend || [])[0];
        if (!first?.month) return;

        const date = new Date(first.month);
        const earliest = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
        earliestRef.current = earliest;
        if (!isCustomRangeRef.current) setRange(getAllTimeRange(earliest));
      })
      .catch(() => {})
      .finally(() => {
        if (isActive) setReady(true);
      });

    return () => {
      isActive = false;
    };
  }, []);

  // Category options are loaded once across all time so the dropdown doesn't shrink while filtering.
  useEffect(() => {
    let isActive = true;

    fetchCategoryBreakdown(DATA_START_FLOOR, formatDateInput(new Date()))
      .then((result) => {
        if (!isActive) return;
        const options = (result?.categories || [])
          .map((entry) => entry.category)
          .filter(Boolean)
          .map((name) => ({ label: name, value: name }));
        setCategoryOptions([{ label: 'All categories', value: 'all' }, ...options]);
      })
      .catch(() => {});

    return () => {
      isActive = false;
    };
  }, []);

  // KPI totals + monthly trend (used by both the sales and demand charts).
  const loadOverview = useCallback(async () => {
    if (!ready) return;
    const requestId = ++overviewRequestRef.current;
    setTrendLoading(true);
    setKpiLoading(true);
    setTrendError('');
    setKpiError('');

    const [trendResult, kpiResult] = await Promise.allSettled([
      fetchSalesTrend(from, to, category),
      fetchKpiSummary(from, to, category),
    ]);

    if (requestId !== overviewRequestRef.current) return;

    if (trendResult.status === 'fulfilled') {
      setTrendData(trendResult.value?.trend || []);
    } else {
      setTrendData([]);
      setTrendError(trendResult.reason?.response?.data?.error || 'Unable to load trend data.');
    }

    if (kpiResult.status === 'fulfilled') {
      setKpiData(kpiResult.value || null);
    } else {
      setKpiData(null);
      setKpiError(kpiResult.reason?.response?.data?.error || 'Unable to load dashboard totals.');
    }

    setTrendLoading(false);
    setKpiLoading(false);
  }, [ready, from, to, category]);

  const loadTopItems = useCallback(async () => {
    if (!ready) return;
    const requestId = ++itemsRequestRef.current;
    setTopItemsLoading(true);
    setTopItemsError('');

    try {
      const result = await fetchTopItems(from, to, 5, category, itemMode === 'least' ? 'asc' : 'desc');
      if (requestId !== itemsRequestRef.current) return;
      setTopItemsData(result?.topItems || []);
    } catch (error) {
      if (requestId !== itemsRequestRef.current) return;
      setTopItemsData([]);
      setTopItemsError(error?.response?.data?.error || 'Unable to load top products.');
    } finally {
      if (requestId === itemsRequestRef.current) setTopItemsLoading(false);
    }
  }, [ready, from, to, category, itemMode]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadTopItems();
  }, [loadTopItems]);

  useEffect(() => {
    const handleSalesDataChanged = () => {
      void loadOverview();
      void loadTopItems();
    };

    window.addEventListener('sales-data-changed', handleSalesDataChanged);
    return () => window.removeEventListener('sales-data-changed', handleSalesDataChanged);
  }, [loadOverview, loadTopItems]);

  const salesTrendChartData = useMemo(
    () =>
      trendData.map((entry) => ({
        month: formatMonth(entry.month),
        revenue: Number(entry.totalRevenue) || 0,
      })),
    [trendData]
  );

  const demandTrendChartData = useMemo(
    () =>
      trendData.map((entry) => ({
        month: formatMonth(entry.month),
        units: Number(entry.totalUnits) || 0,
      })),
    [trendData]
  );

  const topItemsChartData = useMemo(
    () =>
      topItemsData.map((entry) => ({
        itemName: entry.itemName,
        category: entry.category,
        unitsSold: Number(entry.unitsSold) || 0,
        revenue: Number(entry.revenue) || 0,
      })),
    [topItemsData]
  );

  const salesRows = useMemo(() => withGrowth(salesTrendChartData, 'revenue'), [salesTrendChartData]);
  const demandRows = useMemo(() => withGrowth(demandTrendChartData, 'units'), [demandTrendChartData]);

  const scope = category === 'all' ? '' : ` for ${category}`;

  const salesInsight = useMemo(
    () => buildTrendInsight(salesTrendChartData, 'revenue', formatCurrency, 'gross sales', scope),
    [salesTrendChartData, scope]
  );
  const demandInsight = useMemo(
    () => buildTrendInsight(demandTrendChartData, 'units', (value) => `${formatNumber(value)} units`, 'units sold', scope),
    [demandTrendChartData, scope]
  );
  const itemsInsight = useMemo(
    () => buildItemsInsight(topItemsChartData, itemMode, `${formatDateLabel(from)} to ${formatDateLabel(to)}`, scope),
    [topItemsChartData, itemMode, from, to, scope]
  );

  const periodRangeMonths = useMemo(() => {
    const start = new Date(from);
    const end = new Date(to);
    const diff = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
    return diff > 0 ? diff : 0;
  }, [from, to]);

  const totalRevenue = kpiData?.totalRevenue ?? 0;
  const totalUnitsSold = kpiData?.totalUnitsSold ?? 0;
  const avgMonthlyGrossSales = periodRangeMonths > 0 ? totalRevenue / periodRangeMonths : 0;
  const avgMonthlyUnitsSold = periodRangeMonths > 0 ? totalUnitsSold / periodRangeMonths : 0;
  const selectedPeriodLabel = `${formatDateLabel(from)} - ${formatDateLabel(to)}`;

  return (
    <section className="grid gap-6">
      <div className="relative rounded-[2rem] border border-emerald-900/10 bg-[linear-gradient(135deg,#fbfaf7_0%,#eef8ea_100%)] p-6 shadow-sm shadow-emerald-950/5 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 overflow-hidden rounded-full bg-lime-300/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-10 h-32 w-32 overflow-hidden rounded-full bg-emerald-200/30 blur-3xl" />

        <div className="relative flex flex-col gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">Analytics dashboard</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-emerald-950 sm:text-4xl">Welcome back</h1>
          </div>

          {/* General filters: apply to every card and chart on this page */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleDateModeChange('all')}
              aria-pressed={dateMode === 'all'}
              className={`rounded-2xl border px-4 py-2 text-sm font-semibold shadow-sm shadow-emerald-950/5 transition ${
                dateMode === 'all'
                  ? 'border-emerald-950 bg-emerald-950 text-white'
                  : 'border-emerald-900/10 bg-white text-emerald-900/70 hover:bg-emerald-50 hover:text-emerald-950'
              }`}
            >
              All time
            </button>

            <DatePicker
              value={from}
              max={to}
              onChange={handleFromChange}
              label="From"
            />
            <DatePicker
              value={to}
              min={from}
              onChange={handleToChange}
              label="To"
            />

            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Category"
              className="rounded-2xl border border-emerald-900/10 bg-white px-3 py-2 text-sm text-emerald-950 outline-none shadow-sm shadow-emerald-950/5"
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleReset}
              className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-2 text-sm font-medium text-emerald-900/70 shadow-sm shadow-emerald-950/5 transition hover:bg-emerald-50 hover:text-emerald-950"
            >
              Reset filters
            </button>

            <button
              type="button"
              onClick={() => {
                void loadOverview();
                void loadTopItems();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-950 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-950/10 transition hover:bg-emerald-900"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh data
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStatCard
          icon={<Wallet className="h-6 w-6" />}
          label="Total Gross sales"
          value={formatCurrency(totalRevenue)}
          sublabel={selectedPeriodLabel}
          loading={kpiLoading}
          error={kpiError}
        />
        <KpiStatCard
          icon={<Package className="h-6 w-6" />}
          label="Total units sold"
          value={formatNumber(totalUnitsSold)}
          sublabel={selectedPeriodLabel}
          loading={kpiLoading}
          error={kpiError}
        />
        <KpiStatCard
          icon={<Activity className="h-6 w-6" />}
          label="Average monthly gross sales"
          value={formatCurrency(avgMonthlyGrossSales)}
          sublabel={periodRangeMonths ? `Across ${periodRangeMonths} months` : selectedPeriodLabel}
          loading={kpiLoading}
          error={kpiError}
        />
        <KpiStatCard
          icon={<Activity className="h-6 w-6" />}
          label="Average monthly units sold"
          value={formatNumber(avgMonthlyUnitsSold)}
          sublabel={periodRangeMonths ? `Across ${periodRangeMonths} months` : selectedPeriodLabel}
          loading={kpiLoading}
          error={kpiError}
        />
      </div>

      <div className="grid gap-6">
        <SectionCard title="Monthly sales trend">
          {trendError ? (
            <EmptyState title="Sales trend unavailable" description={trendError} />
          ) : trendLoading ? (
            <LoadingState message="Loading trend data..." />
          ) : salesTrendChartData.length === 0 ? (
            <EmptyState title="No trend data in this range" description="Try a wider date range or another category." />
          ) : (
            <>
              <div className="h-[22rem]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesTrendChartData} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e7d8" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} width={70} fontSize={12} />
                    <Tooltip formatter={(value) => formatCurrency(value)} labelStyle={{ color: '#14532d', fontWeight: 600 }} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="plainline"
                      wrapperStyle={{ fontSize: 12, color: '#14532d', paddingBottom: 8 }}
                    />
                    <Line
                      type="linear"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#14532d"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: '#fbfaf7', strokeWidth: 2 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <TrendTable rows={salesRows} valueLabel="Gross Sales" formatValue={formatCurrency} />
              <Insight text={salesInsight} />
            </>
          )}
        </SectionCard>

        <SectionCard title="Monthly demand trend">
          {trendError ? (
            <EmptyState title="Demand trend unavailable" description={trendError} />
          ) : trendLoading ? (
            <LoadingState message="Loading demand data..." />
          ) : demandTrendChartData.length === 0 ? (
            <EmptyState title="No demand data in this range" description="Try a wider date range or another category." />
          ) : (
            <>
              <div className="h-[22rem]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={demandTrendChartData} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e7d8" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} width={56} fontSize={12} />
                    <Tooltip formatter={(value) => formatNumber(value)} labelStyle={{ color: '#14532d', fontWeight: 600 }} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="plainline"
                      wrapperStyle={{ fontSize: 12, color: '#14532d', paddingBottom: 8 }}
                    />
                    <Line
                      type="linear"
                      dataKey="units"
                      name="Units sold"
                      stroke="#65a30d"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: '#fbfaf7', strokeWidth: 2 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <TrendTable rows={demandRows} valueLabel="Units Sold" formatValue={formatNumber} />
              <Insight text={demandInsight} />
            </>
          )}
        </SectionCard>
      </div>

      <SectionCard title={itemMode === 'top' ? 'Top items' : 'Least-selling items'}>
        <div className="mb-5 flex justify-end">
          <div className="flex items-center gap-1 rounded-2xl border border-emerald-900/10 bg-white p-1 shadow-sm shadow-emerald-950/5">
            {[
              { label: 'Top', value: 'top' },
              { label: 'Least', value: 'least' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setItemMode(option.value)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                  itemMode === option.value
                    ? 'bg-emerald-950 text-white shadow-sm shadow-emerald-950/10'
                    : 'text-emerald-900/65 hover:bg-emerald-50 hover:text-emerald-950'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {topItemsError ? (
          <EmptyState title="Item ranking unavailable" description={topItemsError} />
        ) : topItemsLoading ? (
          <LoadingState message="Loading item rankings..." height="min-h-[18rem]" />
        ) : topItemsChartData.length === 0 ? (
          <EmptyState title="No items to display" description="Try another category or a wider date range." />
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
              <div className="h-[18rem]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topItemsChartData} layout="vertical" margin={{ top: 10, right: 24, bottom: 0, left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e7d8" />
                    <XAxis type="number" tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="itemName" tickLine={false} axisLine={false} width={180} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Bar dataKey="revenue" name="Revenue" fill="#14532d" radius={[0, 10, 10, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <ol className="grid content-start gap-2">
                {topItemsChartData.map((item, index) => (
                  <li key={`${item.itemName}-${item.category || 'all'}`} className="flex items-center gap-3 rounded-2xl border border-emerald-900/10 bg-white px-4 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-sm font-semibold text-emerald-800">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-emerald-950">{item.itemName}</p>
                      <p className="mt-1 text-xs text-emerald-900/55">{item.category || 'Uncategorized'} · {formatNumber(item.unitsSold)} units</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-emerald-800">{formatCurrency(item.revenue)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <Insight text={itemsInsight} />
          </>
        )}
      </SectionCard>

      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-emerald-900/40">
        <Sparkles className="h-4 w-4" />
        Clean analytics view
      </div>
    </section>
  );
}