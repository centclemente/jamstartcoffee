import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LineChart,
  UserRound,
  LogOut,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo_green.png';

const adminNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Activity', icon: Activity, path: '/activity' },
  { label: 'Sales', icon: ClipboardList, path: '/sales' },
  { label: 'Reports', icon: BarChart3, path: '/reports' },
  { label: 'Forecasting', icon: LineChart, path: '/forecasts' },
  { label: 'Users', icon: UserRound, path: '/users' },
];

const userNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Sales', icon: ClipboardList, path: '/sales' },
  { label: 'Forecasting', icon: LineChart, path: '/forecasts' },
];

export default function Sidebar() {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const navItems = isAdmin ? adminNavItems : userNavItems;

  const userName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.name || user?.fullName || 'Cafe Operator';
  const userEmail = user?.email || 'active-session@jamstart.coffee';

  return (
    <aside
      className={`flex h-full flex-col border-r border-emerald-900/10 bg-[#f8f6f1] text-emerald-950 transition-all duration-300 ${
        open ? 'w-64' : 'w-28'
      }`}
    >
      <div className="flex h-full flex-col p-4">
        <div className={`flex items-center justify-between gap-3 px-1 py-1 ${open ? '' : 'flex-col items-center'}`}>
          <div className={`flex items-center gap-3 ${open ? '' : 'justify-center'}`}>
            <img src={logo} alt="Jamstart Coffee" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
            {open && (
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.35em] text-lime-700/65">Jamstart Coffee</p>
              </div>
            )}
          </div>

          <button
            onClick={() => setOpen((prev) => !prev)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-950/65 transition hover:bg-emerald-50 hover:text-emerald-950"
            aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        <nav className="mt-5 flex flex-1 flex-col gap-1">
          {navItems.map(({ label, icon: Icon, path }) => {
            const [pathname, hash = ''] = path.split('#');
            const isActive = location.pathname === pathname && (hash ? location.hash === `#${hash}` : location.hash === '');

            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                  open ? 'justify-start' : 'justify-center'
                } ${
                  isActive
                    ? 'border-lime-700/10 bg-lime-100/80 text-emerald-950'
                    : 'border-transparent bg-transparent text-emerald-900/65 hover:border-emerald-900/10 hover:bg-white hover:text-emerald-950'
                }`}
              >
                {isActive && <span className="absolute left-0 top-2.5 h-[calc(100%-1.25rem)] w-0.5 rounded-r-full bg-lime-600" />}
                <Icon className="h-4 w-4 shrink-0" />
                {open && <span>{label}</span>}
              </button>
            );
          })}
        </nav>

        {open ? (
          <div className="mt-5 rounded-2xl border border-emerald-900/10 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-lime-700/10 bg-lime-100 text-lime-900">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-emerald-950">{userName}</p>
                <p className="truncate text-xs text-emerald-900/55">{userEmail}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-lime-100 px-3 py-1 text-xs text-lime-900">
                <span className="h-2 w-2 rounded-full bg-lime-600" />
                Online
              </span>

              <button
                onClick={logout}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/65 transition hover:bg-red-50 hover:text-red-700"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-emerald-900/10 bg-white p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-lime-700/10 bg-lime-100 text-lime-900">
              <UserRound className="h-5 w-5" />
            </div>

            <button
              onClick={logout}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/65 transition hover:bg-red-50 hover:text-red-700"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}

        <p className={`mt-4 text-center text-xs text-emerald-900/35 ${open ? '' : 'hidden'}`}>
          © 2026 Jamstart Coffee
        </p>
      </div>
    </aside>
  );
}