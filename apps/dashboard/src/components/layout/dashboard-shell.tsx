import { Suspense } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { GlobalAssistantModal } from '@/components/assistant-ui/global-assistant-modal'
import { PaywallHost } from '@/components/billing/paywall-host'
import { KeyboardShortcuts } from '@/components/controls/keyboard-shortcuts'
import { HeaderActions } from '@/components/header/header-actions'
import { Breadcrumb } from '@/components/navigation/breadcrumb'
import { ResizableSidebarProvider } from '@/components/resizable-sidebar-provider'
import { DynamicTitle } from '@/components/status/dynamic-title'
import { NetworkStatusBanner } from '@/components/status/network-status-banner'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'

/**
 * App chrome shared by the `(dashboard)` and `(peerdb)` route groups, ported
 * 1:1 from the Next app's `app/(dashboard)/layout.tsx` /
 * `app/(peerdb)/layout.tsx` bodies (which were identical). Renders the
 * resizable sidebar, the header (trigger + breadcrumb + actions), the floating
 * agent, and the toaster around the route `children`.
 *
 * The root document + providers live in `__root.tsx`; this component is only
 * the visual frame, so route groups can opt into it without re-declaring
 * providers. Callers supply their own inner wrapper (e.g. `(dashboard)` wraps
 * children in `FirstRunGate`, `(peerdb)` does not) — matching the Next layouts.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to main content
      </a>
      <Suspense fallback={null}>
        <DynamicTitle />
      </Suspense>
      <NetworkStatusBanner />
      <Suspense fallback={null}>
        <KeyboardShortcuts />
      </Suspense>
      <ResizableSidebarProvider defaultOpen={true}>
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-hidden">
          <header className="relative z-10 flex min-h-16 shrink-0 flex-wrap items-center gap-x-2 gap-y-2 transition-[width,height] ease-linear sm:h-16 sm:flex-nowrap sm:group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 sm:group-has-data-[collapsible=icon]/sidebar-wrapper:min-h-12">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-4 pt-3 sm:pt-0">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="h-4" />
              <Suspense fallback={<Skeleton className="h-4 w-32" />}>
                <Breadcrumb className="min-w-0" />
              </Suspense>
            </div>
            <div className="w-full min-w-0 overflow-x-auto px-4 pb-3 sm:ml-auto sm:w-auto sm:overflow-visible sm:pb-0">
              <HeaderActions />
            </div>
          </header>
          <div
            id="main-content"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pt-0 outline-none sm:gap-4 sm:p-4 sm:pt-0"
          >
            {children}
          </div>
        </SidebarInset>
      </ResizableSidebarProvider>
      <GlobalAssistantModal />
      <PaywallHost />
      <Toaster />
    </>
  )
}
