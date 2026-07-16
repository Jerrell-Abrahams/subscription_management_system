import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, CreditCard, Users, Package, UploadCloud, BarChart3, ChevronDown, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/DropdownMenu';
import { cn } from './ui/cn';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/updates', label: 'Updates', icon: UploadCloud },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
];

export function Layout() {
  const { session, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <nav className="flex w-56 flex-shrink-0 flex-col border-r border-border p-4">
        <h1 className="mb-6 px-2 text-base font-semibold text-text-h">license-platform</h1>
        <ul className="flex-1 space-y-1">
          {links.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text no-underline transition-colors',
                    isActive ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-bg-alt hover:text-text-h'
                  )
                }
              >
                <Icon size={17} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text hover:bg-bg-alt">
              <span className="flex-1 truncate">{session?.user?.email}</span>
              <ChevronDown size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={logout} className="flex items-center gap-2 text-red-600">
              <LogOut size={15} />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <main className="max-w-full flex-1 overflow-x-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
