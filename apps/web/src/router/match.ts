/**
 * Pure, framework-free path matcher. No routing library dependency is
 * genuinely required for apps/web's fixed, small route set (see
 * routeTable.ts) -- this is the entire matching algorithm.
 */
export interface RouteMatch {
  params: Record<string, string>;
}

export function matchPath(pattern: string, pathname: string): RouteMatch | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i] ?? "";
    const pathPart = pathParts[i] ?? "";
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return { params };
}
