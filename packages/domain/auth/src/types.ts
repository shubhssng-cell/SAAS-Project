/** The one, verified identity fact any downstream service is ever handed -- always the output of a real session lookup, never a caller's claim. */
export interface AuthenticatedIdentity {
  studentId: string;
}
