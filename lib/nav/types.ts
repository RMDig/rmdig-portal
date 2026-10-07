// The header's view of a signed-in user. A dependency-free module so the
// public pages' client header can import it without touching auth or the
// database (CLAUDE.md §3.7).
export interface NavViewer {
  email: string;
  isStaff: boolean;
  /** Has something to see on /map: a team, an advertiser account, or staff. */
  hasMap: boolean;
}
