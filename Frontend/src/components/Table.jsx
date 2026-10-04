import { Search, SlidersHorizontal } from 'lucide-react';
import Dropdown from './Dropdown';

export default function Table({
  title,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
  filterValue,
  onFilterChange,
  filterOptions = [],
  actions = null,
  columns = [],
  data = [],
  loading = false,
  emptyState = 'No records found.',
  maxHeight = '32rem',
}) {
  return (
    <section className="rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-sm shadow-emerald-950/5 sm:p-6">
      {(title || onSearchChange || (onFilterChange && filterOptions.length > 0) || actions) && (
        <div className="flex flex-col gap-4 border-b border-emerald-900/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            {title && <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">{title}</p>}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
            {onSearchChange && (
              <label className="flex min-w-0 items-center gap-2 rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-emerald-950 shadow-sm shadow-emerald-950/5 lg:w-[16rem]">
                <Search className="h-4 w-4 shrink-0 text-emerald-900/45" />
                <input
                  value={searchValue}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full min-w-0 bg-transparent text-sm text-emerald-950 outline-none placeholder:text-emerald-900/40"
                />
              </label>
            )}

            {onFilterChange && filterOptions.length > 0 && (
              <Dropdown
                value={filterValue}
                onChange={onFilterChange}
                options={filterOptions}
                icon={SlidersHorizontal}
                className="min-w-[11rem]"
              />
            )}

            {actions && <div className="flex shrink-0 items-center lg:pl-1">{actions}</div>}
          </div>
        </div>
      )}

      <div className="custom-scrollbar mt-5 overflow-auto rounded-2xl" style={{ maxHeight }}>
        <table className="min-w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`sticky top-0 z-10 whitespace-nowrap border-b border-emerald-900/10 bg-[#fbfaf7] px-4 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-900/45 ${column.headerClassName || ''} ${
                    column.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-8 text-sm text-emerald-900/55" colSpan={columns.length}>
                  Loading records...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-sm text-emerald-900/55" colSpan={columns.length}>
                  {emptyState}
                </td>
              </tr>
            ) : (
              data.map((row, rowIndex) => (
                <tr key={row.id ?? rowIndex} className="group">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`border-b border-emerald-900/8 bg-[#fbfaf7] px-4 py-4 text-sm text-emerald-950 ${
                        column.align === 'right' ? 'text-right' : ''
                      } ${column.cellClassName || ''}`}
                    >
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}