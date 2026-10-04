import { useEffect, useRef, useState } from 'react';
import { Activity, RefreshCcw } from 'lucide-react';

import { fetchActivityLogs } from '../api/activity';
import Table from '../components/Table';

const pageSize = 20;

const formatTimestamp = (value) =>
  new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [searchValue, setSearchValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchValue.trim());
      setPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchValue]);

  useEffect(() => {
    let active = true;

    const loadLogs = async () => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setError('');

      try {
        const response = await fetchActivityLogs(page, pageSize, searchTerm);

        if (!active || requestId !== requestRef.current) {
          return;
        }

        setLogs(response.logs || []);
        setTotalPages(response.totalPages || 1);
        setTotalLogs(response.totalLogs || 0);
      } catch {
        if (!active || requestId !== requestRef.current) {
          return;
        }

        setError('Unable to load activity right now.');
        setLogs([]);
      } finally {
        if (active && requestId === requestRef.current) {
          setLoading(false);
        }
      }
    };

    loadLogs();

    return () => {
      active = false;
    };
  }, [page, searchTerm, refreshKey]);

  const columns = [
    {
      key: 'action',
      header: 'Action',
      render: (log) => <span className="font-medium text-emerald-950">{log.action}</span>,
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (log) => (
        <span className="inline-flex rounded-full bg-lime-100 px-3 py-1 text-xs font-medium text-lime-900">
          {log.actor || 'unknown'}
        </span>
      ),
    },
    {
      key: 'timestamp',
      header: 'Time',
      render: (log) => <span className="text-emerald-900/70">{formatTimestamp(log.timestamp)}</span>,
    },
  ];

  return (
    <section className="grid gap-6">
      <div className="overflow-hidden rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] shadow-sm shadow-emerald-950/5">
        <div className="flex items-start gap-4 border-b border-emerald-900/10 px-6 py-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-blue-200/70 bg-blue-50 text-blue-600">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-emerald-950">Activity log</h2>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
          <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm shadow-emerald-950/5">
            <p className="text-xs uppercase tracking-[0.3em] text-lime-700/70">Total events</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-950">{totalLogs}</p>
          </div>
          <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm shadow-emerald-950/5">
            <p className="text-xs uppercase tracking-[0.3em] text-lime-700/70">Showing</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-950">{logs.length}</p>
          </div>
          <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm shadow-emerald-950/5">
            <p className="text-xs uppercase tracking-[0.3em] text-lime-700/70">Current page</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-950">
              {page} of {totalPages}
            </p>
          </div>
        </div>
      </div>

      <Table
        title="Recent activity"
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search activity"
        actions={
          <button
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm font-medium text-emerald-900/80 shadow-sm shadow-emerald-950/5 transition hover:bg-emerald-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        }
        columns={columns}
        data={logs}
        loading={loading}
        emptyState={error || 'No activity has been recorded yet.'}
        maxHeight="36rem"
      />

      <div className="flex flex-col gap-3 rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] px-5 py-4 shadow-sm shadow-emerald-950/5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-emerald-900/65">
          Showing page {page} of {totalPages}. {totalLogs} events found.
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="rounded-xl border border-emerald-900/10 bg-white px-4 py-2 text-sm font-medium text-emerald-900/80 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-xl border border-emerald-900/10 bg-white px-4 py-2 text-sm font-medium text-emerald-900/80 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}