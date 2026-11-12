// A team that is over: not approved (rejected), or withdrawn. It stays in the
// database for staff's review history, but the dashboard folds it away and the
// map leaves it off until the viewer asks for it. Only the team's own members
// and staff ever see it.
export function isPastTeam(status: string): boolean {
  return status === "rejected" || status === "withdrawn";
}
