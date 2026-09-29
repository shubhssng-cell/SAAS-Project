import { useEffect, useRef, type RefObject } from "react";
import { pageTitleForPath } from "./pageTitle.js";
import { usePathname } from "./router.js";

/**
 * On every client-side route change: updates `document.title`, and moves focus to the main
 * landmark. Without this, a keyboard/screen-reader user who activates a link or button stays
 * focused on an element that no longer exists and hears nothing about the new screen.
 *
 * Focus moves only when the pathname actually DIFFERS from the last one seen -- so the initial
 * page load (including React StrictMode's dev-only double-invoked mount effect, which a simple
 * "first render" flag gets wrong) keeps the browser's normal focus start, leaving the skip link
 * as the first Tab stop.
 */
export function useRouteAccessibility(mainRef: RefObject<HTMLElement>): void {
  const pathname = usePathname();
  const lastPathname = useRef(pathname);

  useEffect(() => {
    document.title = pageTitleForPath(pathname);
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, mainRef]);
}
