import { Button } from "../design/index.js";
import { Link, useNavigate } from "../router/router.js";
import { useAuth } from "./AuthContext.js";

/**
 * The minimum useful way to communicate authenticated state in the shell
 * header — the student's own email plus a logout control, or a log-in
 * link. Deliberately NOT profile management/account settings/avatars/
 * preferences (out of scope for this unit).
 */
export function AuthHeaderControl() {
  const { state, logout } = useAuth();
  const navigate = useNavigate();

  if (state.status === "authenticated") {
    return (
      <div className="auth-header-control">
        <span className="auth-header-email">{state.student.email}</span>
        <Button
          variant="secondary"
          className="btn-sm"
          onClick={() => {
            void logout().then(() => navigate("/"));
          }}
        >
          Log out
        </Button>
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return (
      <div className="auth-header-control">
        <Link to="/login" className="btn btn-secondary btn-sm">
          Log in
        </Link>
      </div>
    );
  }

  return null;
}
