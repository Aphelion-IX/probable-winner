import { type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { HomeIcon, LogoutIcon, PlusCircleIcon, UserIcon } from './icons'

const navItems = [
  { to: '/', label: 'Dashboard', icon: HomeIcon, end: true },
  { to: '/projects/new', label: 'New Estimate', icon: PlusCircleIcon, end: false },
]

function navLinkClass(isActive: boolean, orientation: 'row' | 'col') {
  const base =
    orientation === 'row'
      ? 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors'
      : 'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors'
  const state = isActive ? 'text-brand-600' : 'text-steel-500'
  const desktopState = orientation === 'row' ? (isActive ? 'bg-brand-50 text-brand-700' : 'text-steel-600 hover:bg-steel-100') : state
  return `${base} ${desktopState}`
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, isStaff, signOut } = useAuth()

  return (
    <div className="min-h-svh bg-steel-50 lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-steel-200 bg-white lg:flex">
        <div className="flex items-center gap-2 border-b border-steel-200 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            SP
          </div>
          <div>
            <div className="text-sm font-semibold text-steel-900">SpeedPanel</div>
            <div className="text-xs text-steel-500">Site Estimator</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => navLinkClass(isActive, 'row')}>
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-steel-200 px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2">
            <UserIcon className="h-5 w-5 text-steel-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-steel-800">{profile?.display_name ?? 'Account'}</div>
              <div className="truncate text-xs text-steel-500">{isStaff ? profile?.staff_role ?? 'Staff' : 'Customer'}</div>
            </div>
          </div>
          <button
            onClick={() => void signOut()}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-steel-600 hover:bg-steel-100"
          >
            <LogoutIcon className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-svh flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-steel-200 bg-white px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-white">
              SP
            </div>
            <span className="text-sm font-semibold text-steel-900">Site Estimator</span>
          </div>
          <button onClick={() => void signOut()} aria-label="Sign out" className="p-1 text-steel-500">
            <LogoutIcon className="h-5 w-5" />
          </button>
        </header>

        <main className="flex-1 pb-20 lg:pb-0">
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>

        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex border-t border-steel-200 bg-white lg:hidden">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => navLinkClass(isActive, 'col')}>
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
