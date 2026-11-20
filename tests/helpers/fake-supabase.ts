/**
 * Minimal in-memory stand-in for the supabase-js query builder, enough for the
 * org-account tests: select / eq / is / in / contains / order / limit /
 * single / maybeSingle / update / insert, plus rpc handlers. Every call is
 * recorded so tests can assert which tables a code path touched.
 */

type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

export interface FakeSupabaseOptions {
  tables?: Record<string, Row[]>;
  rpc?: Record<string, (args: Record<string, any>) => { data?: any; error?: any }>;
  /** Columns that do not exist yet, per table: selecting one yields 42703. */
  missingColumns?: Record<string, string[]>;
}

export interface FakeCall {
  table?: string;
  rpc?: string;
  op: "select" | "update" | "insert" | "rpc";
  columns?: string;
  values?: Row;
  args?: Record<string, any>;
}

export function createFakeSupabase(opts: FakeSupabaseOptions = {}) {
  const tables: Record<string, Row[]> = opts.tables ?? {};
  const calls: FakeCall[] = [];

  function from(table: string) {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" = "select";
    let columns = "*";
    let values: Row | null = null;
    let limitN: number | null = null;

    const run = (): { data: any; error: any } => {
      if (op === "insert") {
        tables[table].push({ ...(values ?? {}) });
        return { data: [values], error: null };
      }
      if (op === "select") {
        const missing = (opts.missingColumns?.[table] ?? []).filter((c) =>
          columns.split(",").map((s) => s.trim()).includes(c),
        );
        if (missing.length) {
          return { data: null, error: { code: "42703", message: `column ${table}.${missing[0]} does not exist` } };
        }
      }
      let rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of rows) Object.assign(r, values);
        return { data: rows, error: null };
      }
      if (limitN != null) rows = rows.slice(0, limitN);
      return { data: rows, error: null };
    };

    const builder: any = {
      select(cols = "*") {
        if (op === "select") {
          columns = cols;
          calls.push({ table, op: "select", columns: cols });
        }
        return builder;
      },
      update(v: Row) {
        op = "update";
        values = v;
        calls.push({ table, op: "update", values: v });
        return builder;
      },
      insert(v: Row) {
        op = "insert";
        values = v;
        calls.push({ table, op: "insert", values: v });
        return builder;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return builder;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (v === null ? r[c] == null : r[c] === v));
        return builder;
      },
      in(c: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[c]));
        return builder;
      },
      contains(c: string, vs: unknown[]) {
        filters.push((r) => Array.isArray(r[c]) && vs.every((v) => r[c].includes(v)));
        return builder;
      },
      ilike() {
        return builder;
      },
      gt() {
        return builder;
      },
      lt() {
        return builder;
      },
      order() {
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      async single() {
        const { data, error } = run();
        if (error) return { data: null, error };
        if (!data?.length) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: data[0], error: null };
      },
      async maybeSingle() {
        const { data, error } = run();
        if (error) return { data: null, error };
        return { data: data?.[0] ?? null, error: null };
      },
      then(resolve: (v: any) => any, reject?: (e: any) => any) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }

  async function rpc(name: string, args: Record<string, any>) {
    calls.push({ rpc: name, op: "rpc", args });
    const h = opts.rpc?.[name];
    if (!h) return { data: null, error: null };
    const r = h(args);
    return { data: r.data ?? null, error: r.error ?? null };
  }

  return {
    client: { from, rpc, auth: { admin: { getUserById: async () => ({ data: { user: null } }) } } },
    tables,
    calls,
    touched(table: string) {
      return calls.some((c) => c.table === table);
    },
    rpcCalls(name: string) {
      return calls.filter((c) => c.rpc === name);
    },
  };
}
