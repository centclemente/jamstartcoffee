import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Calendar,
  Package,
  RefreshCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
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

import { useAuth } from '../context/AuthContext';
import { fetchCategoryBreakdown, fetchKpiSummary, fetchSalesTrend, fetchTopItems } from '../api/analytics';

const periodOptions = [
  { label: 'All time', value: 'all' },
  { label: 'Last year', value: 'year' },
  { label: 'Last quarter', value: 'quarter' },
  { label: 'Last month', value: 'month' },
];

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-PH');

const monthFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: 'numeric',
});

const monthLabelFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
});

function formatDateInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function getPeriodRange(period) {
  const now = new Date();

  if (period === 'all') {
    return { from: '2020-01-01', to: formatDateInput(now) };
  }

  if (period === 'month') {
    return { from: formatDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: formatDateInput(now) };
  }

  if (period === 'quarter') {
    return { from: formatDateInput(new Date(now.getFullYear(), now.getMonth() - 3, 1)), to: formatDateInput(now) };
  }

  return { from: formatDateInput(new Date(now.getFullYear() - 1, now.getMonth(), 1)), to: formatDateInput(now) };
}

function getKpiRangeFromMonth(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const previousMonthStart = new Date(Date.UTC(year, month - 2, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  const currentMonthEnd = new Date(nextMonthStart.getTime() - 1);

  return {
    from: previousMonthStart.toISOString(),
    to: currentMonthEnd.toISOString(),
  };
}

function getKpiRangeFromYear(yearValue) {
  if (!/^\d{4}$/.test(yearValue)) return null;

  const year = Number(yearValue);
  return {
    from: new Date(Date.UTC(year - 1, 0, 1)).toISOString(),
    to: new Date(Date.UTC(year + 1, 0, 1) - 1).toISOString(),
  };
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

function formatPercent(value) {
  if (value === null || value === undefined) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function SectionCard({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-sm shadow-emerald-950/5 sm:p-6 ${className}`}>
      <div className="flex flex-col gap-4 border-b border-emerald-900/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-lime-700/80">{title}</p>
        </div>
        {action}
      </div>
      <div className="pt-5">{children}</div>
    </section>
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

function YearPicker({ value, onChange, availableYears }) {
  const currentYear = new Date().getFullYear();
  const isAllTime = value === 'all';
  const selectedYear = Number(value) || currentYear;
  const years = availableYears === null ? [selectedYear] : availableYears;
  const firstYear = years[0];
  const lastYear = years[years.length - 1];

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl border border-emerald-900/10 bg-white px-3 py-2 text-sm text-emerald-950 shadow-sm shadow-emerald-950/5">
        <Calendar className="h-4 w-4 shrink-0 text-emerald-900/45" />
        <span>{isAllTime ? 'All time' : value || 'Select year'}</span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-lg shadow-emerald-950/10">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-emerald-900/50">
          <span>Period</span>
          {years.length > 0 && <span>{firstYear}-{lastYear}</span>}
        </div>
        <button
          type="button"
          onClick={() => onChange('all')}
          className={`mb-2 w-full rounded-xl px-2 py-2 text-left text-sm transition ${
            isAllTime ? 'bg-emerald-700 font-semibold text-white' : 'text-emerald-950 hover:bg-emerald-50'
          }`}
        >
          All time
        </button>
        {years.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => onChange(String(year))}
                className={`rounded-xl px-2 py-2 text-sm transition ${
                  year === selectedYear
                    ? 'bg-emerald-700 font-semibold text-white'
                    : 'text-emerald-950 hover:bg-emerald-50'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        ) : (
          <p className="px-2 py-2 text-sm text-emerald-900/60">No years with data</p>
        )}
      </div>
    </details>
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
  const { user } = useAuth();
  const name = user?.first_name || user?.name || 'there';

  const [period, setPeriod] = useState('year');
  const { from, to } = useMemo(() => getPeriodRange(period), [period]);
  const [salesTrendYear, setSalesTrendYear] = useState('all');
  const [demandTrendYear, setDemandTrendYear] = useState('all');
  const [availableTrendYears, setAvailableTrendYears] = useState(null);
  const salesTrendYearRange = useMemo(() => getCalendarYearRange(salesTrendYear), [salesTrendYear]);
  const demandTrendYearRange = useMemo(() => getCalendarYearRange(demandTrendYear), [demandTrendYear]);
  const [kpiMonth, setKpiMonth] = useState('');
  const [kpiYear, setKpiYear] = useState('');
  const [itemMode, setItemMode] = useState('top');
  const [itemCategory, setItemCategory] = useState('all');
  const [categoryOptions, setCategoryOptions] = useState([{ label: 'All categories', value: 'all' }]);

  const [salesTrendData, setSalesTrendData] = useState([]);
  const [demandTrendData, setDemandTrendData] = useState([]);
  const [topItemsData, setTopItemsData] = useState([]);
  const [generalKpiData, setGeneralKpiData] = useState(null);
  const [momData, setMomData] = useState(null);
  const [yoyData, setYoyData] = useState(null);

  const [salesTrendLoading, setSalesTrendLoading] = useState(true);
  const [demandTrendLoading, setDemandTrendLoading] = useState(true);
  const [topItemsLoading, setTopItemsLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [salesTrendError, setSalesTrendError] = useState('');
  const [demandTrendError, setDemandTrendError] = useState('');
  const [topItemsError, setTopItemsError] = useState('');
  const [kpiError, setKpiError] = useState('');
  const [yoyError, setYoyError] = useState('');

  const requestRef = useRef(0);
  const kpiMonthInitializedRef = useRef(false);
  const kpiYearInitializedRef = useRef(false);

  useEffect(() => {
    let isActive = true;

    fetchSalesTrend('2020-01-01', formatDateInput(new Date()))
      .then((result) => {
        if (!isActive) return;

        const years = [...new Set(
          (result?.trend || [])
            .map((entry) => new Date(entry.month).getUTCFullYear())
            .filter((year) => Number.isFinite(year))
        )].sort((firstYear, secondYear) => firstYear - secondYear);

        setAvailableTrendYears(years);

        if (years.length > 0) {
          const latestYear = String(years[years.length - 1]);
          setSalesTrendYear((year) => (year === 'all' || years.includes(Number(year)) ? year : latestYear));
          setDemandTrendYear((year) => (year === 'all' || years.includes(Number(year)) ? year : latestYear));
        }
      })
      .catch(() => {
        if (isActive) setAvailableTrendYears([]);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const kpiRange = useMemo(() => {
    if (!kpiMonth) return { from, to };
    return getKpiRangeFromMonth(kpiMonth) || { from, to };
  }, [kpiMonth, from, to]);

  const yoyRange = useMemo(() => getKpiRangeFromYear(kpiYear) || { from, to }, [kpiYear, from, to]);

  // Helper function to get month labels
  const getMonthLabels = useCallback(() => {
    let year, month;

    if (kpiMonth) {
      const match = /^(\d{4})-(\d{2})$/.exec(kpiMonth);
      if (!match) return { current: 'N/A', previous: 'N/A' };
      year = Number(match[1]);
      month = Number(match[2]);
    } else {
      // Use current date if no filter selected
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const currentDate = new Date(year, month - 1, 1);
    const previousDate = new Date(year, month - 2, 1);

    return {
      current: monthLabelFormatter.format(currentDate),
      previous: monthLabelFormatter.format(previousDate),
    };
  }, [kpiMonth]);

  const loadOverview = useCallback(async () => {
    const requestId = ++requestRef.current;
    setSalesTrendLoading(true);
    setDemandTrendLoading(true);
    setTopItemsLoading(true);
    setKpiLoading(true);
    setSalesTrendError('');
    setDemandTrendError('');
    setTopItemsError('');
    setKpiError('');
    setYoyError('');

    const [salesTrendResult, demandTrendResult, topItemsResult, categoryResult, generalKpiResult, momResult, yoyResult] = await Promise.allSettled([
      fetchSalesTrend(salesTrendYearRange.from, salesTrendYearRange.to),
      fetchSalesTrend(demandTrendYearRange.from, demandTrendYearRange.to),
      fetchTopItems(from, to, 5, itemCategory, itemMode === 'least' ? 'asc' : 'desc'),
      fetchCategoryBreakdown(from, to),
      fetchKpiSummary(from, to),
      fetchKpiSummary(kpiRange.from, kpiRange.to),
      fetchKpiSummary(yoyRange.from, yoyRange.to),
    ]);

    if (requestId !== requestRef.current) return;

    if (salesTrendResult.status === 'fulfilled') {
      setSalesTrendData(salesTrendResult.value?.trend || []);
    } else {
      setSalesTrendData([]);
      setSalesTrendError(salesTrendResult.reason?.response?.data?.error || 'Unable to load sales trend.');
    }

    if (demandTrendResult.status === 'fulfilled') {
      setDemandTrendData(demandTrendResult.value?.trend || []);
    } else {
      setDemandTrendData([]);
      setDemandTrendError(demandTrendResult.reason?.response?.data?.error || 'Unable to load demand trend.');
    }

    if (topItemsResult.status === 'fulfilled') {
      setTopItemsData(topItemsResult.value?.topItems || []);
    } else {
      setTopItemsData([]);
      setTopItemsError(topItemsResult.reason?.response?.data?.error || 'Unable to load top products.');
    }

    if (categoryResult.status === 'fulfilled') {
      const options = (categoryResult.value?.categories || [])
        .map((entry) => entry.category)
        .filter(Boolean)
        .map((category) => ({ label: category, value: category }));
      setCategoryOptions([{ label: 'All categories', value: 'all' }, ...options]);
      if (itemCategory !== 'all' && !options.some((option) => option.value === itemCategory)) {
        setItemCategory('all');
      }
    }

    if (generalKpiResult.status === 'fulfilled') {
      setGeneralKpiData(generalKpiResult.value || null);
    } else {
      setGeneralKpiData(null);
      setKpiError(generalKpiResult.reason?.response?.data?.error || 'Unable to load dashboard totals.');
    }

    if (momResult.status === 'fulfilled') {
      setMomData(momResult.value || null);
    } else {
      setMomData(null);
      setKpiError(momResult.reason?.response?.data?.error || 'Unable to load month over month growth.');
    }

    if (yoyResult.status === 'fulfilled') {
      setYoyData(yoyResult.value || null);
    } else {
      setYoyData(null);
      setYoyError(yoyResult.reason?.response?.data?.error || 'Unable to load year over year growth.');
    }

    setSalesTrendLoading(false);
    setDemandTrendLoading(false);
    setTopItemsLoading(false);
    setKpiLoading(false);
  }, [salesTrendYearRange, demandTrendYearRange, from, to, itemCategory, itemMode, kpiRange, yoyRange]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const handleSalesDataChanged = () => {
      void loadOverview();
    };

    window.addEventListener('sales-data-changed', handleSalesDataChanged);
    return () => window.removeEventListener('sales-data-changed', handleSalesDataChanged);
  }, [loadOverview]);

  useEffect(() => {
    if (kpiMonthInitializedRef.current || salesTrendLoading || salesTrendData.length === 0) return;

    const latestMonthWithData = [...salesTrendData].reverse()[0];
    if (!latestMonthWithData?.month) return;

    const latestMonth = new Date(latestMonthWithData.month);
    const monthValue = `${latestMonth.getUTCFullYear()}-${String(latestMonth.getUTCMonth() + 1).padStart(2, '0')}`;
    setKpiMonth(monthValue);
    kpiMonthInitializedRef.current = true;
  }, [salesTrendData, salesTrendLoading]);

  useEffect(() => {
    if (kpiYearInitializedRef.current || salesTrendLoading || salesTrendData.length === 0) return;

    const latestEntryWithData = [...salesTrendData].reverse().find((entry) => Number(entry.totalRevenue) > 0);
    if (!latestEntryWithData?.month) return;

    setKpiYear(String(new Date(latestEntryWithData.month).getUTCFullYear()));
    kpiYearInitializedRef.current = true;
  }, [salesTrendData, salesTrendLoading]);

  const salesTrendChartData = useMemo(
    () =>
      salesTrendData.map((entry) => ({
        month: formatMonth(entry.month),
        revenue: Number(entry.totalRevenue) || 0,
        units: Number(entry.totalUnits) || 0,
      })),
    [salesTrendData]
  );

  const demandTrendChartData = useMemo(
    () =>
      demandTrendData.map((entry) => ({
        month: formatMonth(entry.month),
        units: Number(entry.totalUnits) || 0,
      })),
    [demandTrendData]
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

  const periodRangeMonths = useMemo(() => {
    const start = new Date(from);
    const end = new Date(to);
    const diff = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
    return diff > 0 ? diff : 0;
  }, [from, to]);

  const totalRevenue = generalKpiData?.totalRevenue ?? 0;
  const totalUnitsSold = generalKpiData?.totalUnitsSold ?? 0;
  const avgMonthlyGrossSales = periodRangeMonths > 0 ? totalRevenue / periodRangeMonths : 0;
  const avgMonthlyUnitsSold = periodRangeMonths > 0 ? totalUnitsSold / periodRangeMonths : 0;
  const selectedPeriodLabel = periodOptions.find((option) => option.value === period)?.label || 'Selected period';

  const handleRefresh = () => {
    void loadOverview();
  };

  const momChangePct = momData?.monthOverMonth?.changePct ?? null;
  const isGrowthPositive = momChangePct !== null && momChangePct >= 0;
  const currentMonthRevenue = momData?.monthOverMonth?.currentMonthRevenue ?? 0;
  const previousMonthRevenue = momData?.monthOverMonth?.previousMonthRevenue ?? 0;
  const yoyChangePct = yoyData?.yearOverYear?.changePct ?? null;
  const isYoyGrowthPositive = yoyChangePct !== null && yoyChangePct >= 0;
  const currentYearRevenue = yoyData?.yearOverYear?.currentYearRevenue ?? 0;
  const previousYearRevenue = yoyData?.yearOverYear?.previousYearRevenue ?? 0;
  const selectedYear = kpiYear || String(new Date().getFullYear());

  const { current: currentLabel, previous: previousLabel } = getMonthLabels();

  return (
    <section className="grid gap-6">
      <div className="relative overflow-hidden rounded-[2rem] border border-emerald-900/10 bg-[linear-gradient(135deg,#fbfaf7_0%,#eef8ea_100%)] p-6 shadow-sm shadow-emerald-950/5 sm:p-8">
        <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-lime-300/20 blur-3xl" />
        <div className="absolute bottom-0 right-10 h-32 w-32 rounded-full bg-emerald-200/30 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">Analytics dashboard</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-emerald-950 sm:text-4xl">
              Welcome back, {name}. Your cafe performance is easy to scan.
            </h1>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-900/10 bg-white p-1 shadow-sm shadow-emerald-950/5">
              {periodOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPeriod(option.value)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    period === option.value
                      ? 'bg-emerald-950 text-white shadow-sm shadow-emerald-950/10'
                      : 'text-emerald-900/65 hover:bg-emerald-50 hover:text-emerald-950'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-950 px-4 py-3 text-sm font-medium text-white shadow-sm shadow-emerald-950/10 transition hover:bg-emerald-900"
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

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Monthly sales trend"
          action={
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-emerald-900/50">Trend year</span>
              <YearPicker value={salesTrendYear} onChange={setSalesTrendYear} availableYears={availableTrendYears} />
            </div>
          }
        >
          {salesTrendError ? (
            <EmptyState title="Sales trend unavailable" description={salesTrendError} />
          ) : salesTrendLoading ? (
            <div className="flex min-h-[22rem] items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-900/10 bg-white text-sm text-emerald-900/55">
              Loading trend data...
            </div>
          ) : salesTrendChartData.length === 0 ? (
            <EmptyState title="No trend data in this range" description="Try a wider period preset to show more historical sales activity." />
          ) : (
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
          )}
        </SectionCard>

        <SectionCard
          title="Monthly demand trend"
          action={
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-emerald-900/50">Trend year</span>
              <YearPicker value={demandTrendYear} onChange={setDemandTrendYear} availableYears={availableTrendYears} />
            </div>
          }
        >
          {demandTrendError ? (
            <EmptyState title="Demand trend unavailable" description={demandTrendError} />
          ) : demandTrendLoading ? (
            <div className="flex min-h-[22rem] items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-900/10 bg-white text-sm text-emerald-900/55">
              Loading demand data...
            </div>
          ) : demandTrendChartData.length === 0 ? (
            <EmptyState title="No demand data in this year" description="Choose another year to show recorded monthly demand." />
          ) : (
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
          )}
        </SectionCard>

      </div>

      <div className="grid gap-6 xl:grid-cols-6">
        <SectionCard
          title="Month over month growth"
          className="xl:col-span-3"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-2xl border border-emerald-900/10 bg-white px-3 py-2 text-sm text-emerald-950 shadow-sm shadow-emerald-950/5">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-900/45" />
                <input
                  type="month"
                  value={kpiMonth}
                  onChange={(e) => setKpiMonth(e.target.value)}
                  className="bg-transparent text-sm text-emerald-950 outline-none"
                />
              </label>

              {kpiMonth && (
                <button
                  type="button"
                  onClick={() => setKpiMonth('')}
                  className="rounded-xl border border-emerald-900/10 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-emerald-900/60 transition hover:bg-emerald-50 hover:text-emerald-950"
                >
                  Clear
                </button>
              )}
            </div>
          }
        >
          {kpiError ? (
            <EmptyState title="Growth data unavailable" description={kpiError} />
          ) : kpiLoading ? (
            <div className="flex min-h-[22rem] items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-900/10 bg-white text-sm text-emerald-900/55">
              Loading growth data...
            </div>
          ) : momChangePct === null ? (
            <EmptyState title="Not enough data" description="Previous month has no recorded sales to compare against." />
          ) : (
            <div className="flex h-[22rem] flex-col justify-center gap-6">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                    isGrowthPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
                  }`}
                >
                  {isGrowthPositive ? <TrendingUp className="h-7 w-7" /> : <TrendingDown className="h-7 w-7" />}
                </div>
                <div>
                  <p className={`text-3xl font-semibold ${isGrowthPositive ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {formatPercent(momChangePct)}
                  </p>
                  <p className="text-sm text-emerald-900/60">vs. last month</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-emerald-900/10 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-900/50">{currentLabel}</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-950">{formatCurrency(currentMonthRevenue)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-900/10 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-900/50">{previousLabel}</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-950">{formatCurrency(previousMonthRevenue)}</p>
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Year over year growth"
          className="xl:col-span-3"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <YearPicker value={kpiYear} onChange={setKpiYear} availableYears={availableTrendYears} />

              {kpiYear && (
                <button
                  type="button"
                  onClick={() => setKpiYear('')}
                  className="rounded-xl border border-emerald-900/10 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-emerald-900/60 transition hover:bg-emerald-50 hover:text-emerald-950"
                >
                  Clear
                </button>
              )}
            </div>
          }
        >
          {yoyError ? (
            <EmptyState title="Growth data unavailable" description={yoyError} />
          ) : kpiLoading ? (
            <div className="flex min-h-[22rem] items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-900/10 bg-white text-sm text-emerald-900/55">
              Loading growth data...
            </div>
          ) : yoyChangePct === null ? (
            <EmptyState title="Not enough data" description="Previous year has no recorded sales to compare against." />
          ) : (
            <div className="flex h-[22rem] flex-col justify-center gap-6">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                    isYoyGrowthPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
                  }`}
                >
                  {isYoyGrowthPositive ? <TrendingUp className="h-7 w-7" /> : <TrendingDown className="h-7 w-7" />}
                </div>
                <div>
                  <p className={`text-3xl font-semibold ${isYoyGrowthPositive ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {formatPercent(yoyChangePct)}
                  </p>
                  <p className="text-sm text-emerald-900/60">vs. previous year</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-emerald-900/10 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-900/50">{selectedYear}</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-950">{formatCurrency(currentYearRevenue)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-900/10 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-900/50">{Number(selectedYear) - 1}</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-950">{formatCurrency(previousYearRevenue)}</p>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={itemMode === 'top' ? 'Top items' : 'Least-selling items'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={itemCategory}
              onChange={(event) => setItemCategory(event.target.value)}
              className="rounded-2xl border border-emerald-900/10 bg-white px-3 py-2 text-sm text-emerald-950 outline-none shadow-sm shadow-emerald-950/5"
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

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
        }
      >
        {topItemsError ? (
          <EmptyState title="Item ranking unavailable" description={topItemsError} />
        ) : topItemsLoading ? (
          <div className="flex min-h-[18rem] items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-900/10 bg-white text-sm text-emerald-900/55">
            Loading item rankings...
          </div>
        ) : topItemsChartData.length === 0 ? (
          <EmptyState title="No items to display" description="Try another category or a wider period preset." />
        ) : (
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
        )}
      </SectionCard>

      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-emerald-900/40">
        <Sparkles className="h-4 w-4" />
        Clean analytics view
      </div>
    </section>
  );
}

function getCalendarYearRange(yearValue) {
  if (yearValue === 'all') {
    return getPeriodRange('all');
  }

  if (!/^\d{4}$/.test(yearValue)) return null;

  const year = Number(yearValue);
  return {
    from: new Date(Date.UTC(year, 0, 1)).toISOString(),
    to: new Date(Date.UTC(year + 1, 0, 1) - 1).toISOString(),
  };
}