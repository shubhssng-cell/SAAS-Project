/**
 * The one place an API base URL is resolved. Empty string (the default)
 * means "same origin as this page" -- correct for both the Vite dev proxy
 * (`vite.config.ts` forwards `/v1/*` to `apps/api`) and a production
 * deployment that reverse-proxies the API under the same origin. Only set
 * `VITE_API_BASE_URL` if a genuinely separate API origin is ever needed;
 * no component ever hardcodes a URL itself.
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
