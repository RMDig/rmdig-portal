// A tiny in-memory stand-in for the Drizzle surface the auth modules use, so a
// test can run a multi-step sequence (sign up → OAuth link → sign in) against
// state rather than against canned return values. Unit tests stay pure (no DB,
// CLAUDE.md §4.3): the test mocks `@/lib/db`, `@/lib/db/schema` and
// `drizzle-orm` with the exports below.
//
// Scope is deliberately small: select/insert/update/delete with eq, and, isNull
// and gt predicates, `.limit()`, `.returning()`, and `transaction()`. Anything
// else throws, so a query shape the fake doesn't model fails the test loudly
// instead of silently matching nothing.

export type Row = Record<string, unknown>;

type Pred =
  | { op: "eq"; col: string; val: unknown }
  | { op: "gt"; col: string; val: unknown }
  | { op: "isNull"; col: string }
  | { op: "and"; preds: Pred[] };

interface Table {
  __t: string;
}

// Column references resolve to their own property name: users.email === "email".
export function fakeTable(name: string): Table & Record<string, string> {
  return new Proxy({ __t: name } as Table & Record<string, string>, {
    get: (target, key) => (key === "__t" ? target.__t : String(key)),
  });
}

export const fakeOperators = {
  eq: (col: string, val: unknown): Pred => ({ op: "eq", col, val }),
  gt: (col: string, val: unknown): Pred => ({ op: "gt", col, val }),
  isNull: (col: string): Pred => ({ op: "isNull", col }),
  and: (...preds: Array<Pred | undefined>): Pred => ({
    op: "and",
    preds: preds.filter((p): p is Pred => p !== undefined),
  }),
};

function matches(row: Row, pred: Pred): boolean {
  switch (pred.op) {
    case "eq":
      return row[pred.col] instanceof Date && pred.val instanceof Date
        ? (row[pred.col] as Date).getTime() === pred.val.getTime()
        : row[pred.col] === pred.val;
    case "gt":
      return (row[pred.col] as number | Date) > (pred.val as number | Date);
    case "isNull":
      return row[pred.col] === null || row[pred.col] === undefined;
    case "and":
      return pred.preds.every((p) => matches(row, p));
  }
}

function project(row: Row, fields?: Record<string, string>): Row {
  if (!fields) return { ...row };
  return Object.fromEntries(Object.entries(fields).map(([k, col]) => [k, row[col] ?? null]));
}

export interface FakeDb {
  tables: Map<string, Row[]>;
  rows(name: string): Row[];
  db: Record<string, unknown>;
}

export function createFakeDb(): FakeDb {
  const tables = new Map<string, Row[]>();
  const rows = (name: string): Row[] => {
    let t = tables.get(name);
    if (!t) {
      t = [];
      tables.set(name, t);
    }
    return t;
  };

  const db: Record<string, unknown> = {
    select: (fields?: Record<string, string>) => ({
      from: (table: Table) => ({
        where: (pred: Pred) => {
          const result = () => rows(table.__t).filter((r) => matches(r, pred)).map((r) => project(r, fields));
          return Object.assign(Promise.resolve().then(result), {
            limit: (n: number) => Promise.resolve().then(() => result().slice(0, n)),
          });
        },
      }),
    }),
    insert: (table: Table) => ({
      values: (vals: Row) => {
        const row = { ...vals };
        rows(table.__t).push(row);
        return Object.assign(Promise.resolve(), {
          returning: (fields?: Record<string, string>) => Promise.resolve([project(row, fields)]),
        });
      },
    }),
    update: (table: Table) => ({
      set: (vals: Row) => ({
        where: (pred: Pred) => {
          const hit = rows(table.__t).filter((r) => matches(r, pred));
          for (const r of hit) Object.assign(r, vals);
          return Object.assign(Promise.resolve(), {
            returning: (fields?: Record<string, string>) => Promise.resolve(hit.map((r) => project(r, fields))),
          });
        },
      }),
    }),
    delete: (table: Table) => ({
      where: (pred: Pred) => {
        const kept = rows(table.__t).filter((r) => !matches(r, pred));
        tables.set(table.__t, kept);
        return Promise.resolve();
      },
    }),
  };
  db.transaction = async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => fn(db);

  return { tables, rows, db };
}
