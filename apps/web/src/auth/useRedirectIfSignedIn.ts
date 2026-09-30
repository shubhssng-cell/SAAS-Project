import { useEffect, useRef } from "react";
import { useNavigate } from "../router/router.js";
import { useAuth } from "./AuthContext.js";

/**
 * For the public Log in / Sign up pages: a student who is ALREADY signed in when they arrive
 * (e.g. pressed Back after logging in) is sent on to `/dashboard` instead of being shown an empty
 * credentials form under a header that says they're logged in. Presentational only -- the
 * server's session stays the sole authority.
 *
 * The returned function must be called when the page's own submit handler starts: a student who
 * becomes signed in BY that submit is navigated by the handler itself (signup -> `/onboarding`,
 * login -> `/dashboard`), and this hook must not race it with a second redirect.
 */
export function useRedirectIfSignedIn(): () => void {
  const { state } = useAuth();
  const navigate = useNavigate();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (state.status === "authenticated" && !submittedRef.current) navigate("/dashboard");
  }, [state.status, navigate]);

  return () => {
    submittedRef.current = true;
  };
}
