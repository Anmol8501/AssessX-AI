import { useState, type ComponentType, type SVGProps } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { RefreshIcon, SignOutIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { Button, ConfirmDialog, StatusBadge } from '@/components/ui'
import { APP_VERSION } from '@/config/app'
import { ROLE_LABEL, useCurrentUser, useSession } from '@/features/session'
import { cn } from '@/lib/cn'

export interface NavItem {
  label: string
  to: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Match only the exact path (for the section's index route). */
  end?: boolean
}

interface AppShellProps {
  nav: readonly NavItem[]
}

/**
 * Authenticated application frame: dark sidebar with role navigation, a top bar with the
 * current section and the signed-in user, and a scrolling content area for the routed page.
 *
 * **Refresh** re-mounts the routed page, so it fetches everything from the server again — newly
 * assigned exams, new results, changes another admin made — without signing out or reloading the
 * whole application. Anything typed but not yet saved on that page is discarded, as with any reload.
 */
export function AppShell({ nav }: AppShellProps) {
  const user = useCurrentUser()
  const { signOut } = useSession()
  const { pathname } = useLocation()
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  function handleRefresh() {
    setRefreshKey((key) => key + 1)
    // Brief feedback only: each page shows its own loading state while it refetches.
    setRefreshing(true)
    window.setTimeout(() => setRefreshing(false), 600)
  }

  const current = nav.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      // The route guard redirects to the login screen once the session is gone.
    } finally {
      setSigningOut(false)
      setConfirmingSignOut(false)
    }
  }

  return (
    <div className="flex h-full w-full">
      <aside className="bg-sidebar flex w-60 shrink-0 flex-col" aria-label="Primary">
        <div className="flex h-14 items-center px-5">
          <Logo inverted withMark size="sm" />
        </div>

        <nav className="mt-2 flex-1 space-y-0.5 px-3">
          {nav.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-3 rounded-md px-3 text-[13.5px] font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-active text-white'
                    : 'text-ink-inverse-muted hover:bg-sidebar-hover hover:text-white',
                )
              }
            >
              <Icon className="text-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <span className="bg-sidebar-active flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white">
              {initials(user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-white">{user.name}</p>
              <p className="text-ink-inverse-muted truncate text-[12px]">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConfirmingSignOut(true)}
            className="text-ink-inverse-muted hover:bg-sidebar-hover mt-1 flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13.5px] font-medium transition-colors hover:text-white"
          >
            <SignOutIcon className="text-[18px]" />
            Sign out
          </button>
          <p className="text-ink-inverse-muted/70 mt-2 px-3 font-mono text-[11px]">v{APP_VERSION}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-card flex h-14 shrink-0 items-center justify-between border-b px-6">
          <div className="text-ink-subtle flex items-center gap-2 text-[13px]">
            <span>{ROLE_LABEL[user.role]}</span>
            {current && (
              <>
                <span aria-hidden="true">/</span>
                <span className="text-ink font-medium">{current.label}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              leadingIcon={<RefreshIcon className={cn(refreshing && 'animate-spin')} />}
              title="Reload this page's data from the server"
            >
              Refresh
            </Button>
            <StatusBadge tone="accent">{ROLE_LABEL[user.role]}</StatusBadge>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-8 py-7">
            {/* Keyed so Refresh re-mounts the page and every one of its data hooks refetches. */}
            <Outlet key={refreshKey} />
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out of AssessX?"
        description="You will need to sign in again to continue."
        confirmLabel="Sign out"
        busy={signingOut}
        onConfirm={handleSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </div>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}
