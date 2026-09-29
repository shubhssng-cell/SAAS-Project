import { useCallback, useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * Minimal, dependency-free client-side navigation: `history.pushState` +
 * `popstate` + `useSyncExternalStore`. apps/web has ten fixed routes (see
 * routeTable.ts) -- a routing library is not genuinely required for that,
 * per Product Phase 1 Unit 2's "minimum appropriate dependency" rule.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

function getPathname(): string {
  return window.location.pathname;
}

function subscribe(listener: Listener): () => void {
  window.addEventListener("popstate", listener);
  listeners.add(listener);
  return () => {
    window.removeEventListener("popstate", listener);
    listeners.delete(listener);
  };
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Pushes a new URL and notifies subscribers -- `pushState` alone does not fire `popstate`. */
export function navigate(path: string): void {
  if (path !== window.location.pathname) {
    window.history.pushState({}, "", path);
  }
  notify();
}

/** Re-renders the subscribing component on every route change (pushState-driven or back/forward-driven). */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname, getPathname);
}

export function useNavigate(): (path: string) => void {
  return useCallback((path: string) => navigate(path), []);
}

/** A plain in-app link -- left-click with no modifier keys navigates client-side; everything else (middle-click, ctrl/cmd-click, right-click) falls through to normal browser `<a>` behavior. */
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
