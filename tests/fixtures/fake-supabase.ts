/**
 * Small in-memory stand-in for the Supabase admin client, enough for the
 * sign-in / provisioning tests: chained filters, count/head selects, insert,
 * update, delete, `col->>key` JSON paths, and UNIQUE constraints (returned as
 * Postgres 23505, like PostgREST does). Every operation resolves on a later
 * tick so concurrent callers interleave.
 */
type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

export interface FakeDbOptions {
  /** table -> columns that are UNIQUE */
  unique?: Record<string, string[]>;
  /** table -> error returned by every operation on it */
  failing?: Record<string, { message: string; code?: string }>;
}

function read(row: Row, column: string): unknown {
  if (column.includes("->>")) {
    const [col, key] = column.split("->>");
    const obj = row[col!];
    return obj && typeof obj === "object" ? (obj[key!] ?? null) : null;
  }
  return row[column] ?? null;
}

function likeToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\" && i + 1 < pattern.length) {
      out += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

let seq = 0;

export function createFakeDb(options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {};
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const table = (name: string) => (tables[name] ??= []);

  function builder(name: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: any = null;
    let wantCount = false;
    let head = false;
    let returning = false;
    let limitN: number | null = null;
    let orderBy: Array<{ col: string; asc: boolean }> = [];
    let mode: "many" | "single" | "maybeSingle" = "many";

    const run = async () => {
      await new Promise((r) => setTimeout(r, 0));
      const failing = options.failing?.[name];
      if (failing) return { data: null, error: failing, count: null };
      const rows = table(name);
      calls.push({ table: name, op, payload });

      if (op === "insert") {
        const incoming: Row[] = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({
          id: r.id ?? `id-${++seq}`,
          created_at: r.created_at ?? new Date(Date.now() + seq).toISOString(),
          ...r,
        }));
        for (const r of incoming) {
          for (const col of options.unique?.[name] ?? []) {
            if (r[col] != null && rows.some((x) => x[col] === r[col])) {
              return {
                data: null,
                error: { code: "23505", message: `duplicate key value violates unique constraint "${name}_${col}_key"` },
                count: null,
              };
            }
          }
        }
        rows.push(...incoming);
        return finish(incoming);
      }

      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, payload);
        return finish(matched);
      }
      if (op === "delete") {
        for (const r of matched) rows.splice(rows.indexOf(r), 1);
        return finish(matched);
      }
      return finish(matched, true);
    };

    const finish = (rows: Row[], isSelect = false) => {
      let out = [...rows];
      for (const { col, asc } of [...orderBy].reverse()) {
        out.sort((a, b) => (String(read(a, col)) < String(read(b, col)) ? -1 : 1) * (asc ? 1 : -1));
      }
      const count = wantCount ? out.length : null;
      if (limitN != null) out = out.slice(0, limitN);
      if (!isSelect && !returning) return { data: null, error: null, count };
      if (head) return { data: null, error: null, count };
      if (mode === "single") {
        if (out.length !== 1) return { data: null, error: { code: "PGRST116", message: "not exactly one row" }, count };
        return { data: { ...out[0] }, error: null, count };
      }
      if (mode === "maybeSingle") {
        if (out.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" }, count };
        return { data: out[0] ? { ...out[0] } : null, error: null, count };
      }
      return { data: out.map((r) => ({ ...r })), error: null, count };
    };

    const api: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        if (opts?.count) wantCount = true;
        if (opts?.head) head = true;
        return api;
      },
      insert(row: Row | Row[]) { op = "insert"; payload = row; return api; },
      update(patch: Row) { op = "update"; payload = patch; return api; },
      delete() { op = "delete"; return api; },
      eq(col: string, v: unknown) { filters.push((r) => read(r, col) === v); return api; },
      neq(col: string, v: unknown) { filters.push((r) => read(r, col) !== v); return api; },
      in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(read(r, col))); return api; },
      is(col: string, v: unknown) { filters.push((r) => read(r, col) === v); return api; },
      lt(col: string, v: string) { filters.push((r) => String(read(r, col)) < v); return api; },
      gte(col: string, v: string) { filters.push((r) => String(read(r, col)) >= v); return api; },
      ilike(col: string, pattern: string) {
        const re = likeToRegExp(pattern);
        filters.push((r) => typeof read(r, col) === "string" && re.test(read(r, col) as string));
        return api;
      },
      order(col: string, o?: { ascending?: boolean }) { orderBy.push({ col, asc: o?.ascending !== false }); return api; },
      limit(n: number) { limitN = n; return api; },
      single() { mode = "single"; return run(); },
      maybeSingle() { mode = "maybeSingle"; return run(); },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return run().then(resolve, reject);
      },
    };
    return api;
  }

  return {
    tables,
    calls,
    table,
    from: (name: string) => builder(name),
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
