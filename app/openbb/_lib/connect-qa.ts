/**
 * Connect-time QA for the OpenBB Workspace adapter.
 *
 * Workspace validates widgets.json (and apps.json) when Minh hits Add /
 * Test. Each failure she has already caught is a case here so CI fails
 * before the next Connect, not after.
 *
 * Protocol: a new Connect error becomes a named case in
 * tests/openbb-connect-qa.test.ts, then a rule in this file.
 *
 * Cases so far:
 *   #194  type "pdf" is not a widgets.json type
 *   #344  multi_file_viewer missing roles: ["fileSelector"]
 *   #350  file widget endpoint is GET-only (Workspace POSTs)
 *   #355  staleTime: 0 → "[staleTime]: Invalid input"
 */

export type ConnectIssue = {
  widgetId: string;
  field: string;
  message: string;
};

/** OpenBB widgets.json `type` enum (docs 2026-08-21). `pdf` is not in it. */
export const WIDGET_TYPES = new Set([
  "chart",
  "table",
  "table_ssrm",
  "markdown",
  "metric",
  "note",
  "multi_file_viewer",
  "live_grid",
  "newsfeed",
  "advanced-chart",
  "chart-highcharts",
  "chart-vegalite",
  "youtube",
  "iframe",
]);

export const PARAM_TYPES = new Set([
  "date",
  "text",
  "ticker",
  "number",
  "boolean",
  "endpoint",
  "form",
  "tabs",
]);

type WidgetParam = {
  paramName?: unknown;
  type?: unknown;
  roles?: unknown;
  optionsEndpoint?: unknown;
};

type WidgetDef = {
  name?: unknown;
  description?: unknown;
  endpoint?: unknown;
  type?: unknown;
  staleTime?: unknown;
  refetchInterval?: unknown;
  gridData?: { w?: unknown; h?: unknown };
  params?: WidgetParam[];
};

type AppLayoutItem = { i?: string };
type AppTab = { layout?: AppLayoutItem[] };
type AppGroup = { widgetIds?: string[] };
type WorkspaceApp = {
  name?: string;
  tabs?: Record<string, AppTab>;
  groups?: AppGroup[];
  prompts?: string[];
};

function issue(widgetId: string, field: string, message: string): ConnectIssue {
  return { widgetId, field, message };
}

function asWidgets(raw: unknown): Record<string, WidgetDef> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, WidgetDef>;
}

function isCron(s: string): boolean {
  return s.trim().split(/\s+/).length >= 5;
}

export function validateWidgetDefs(raw: unknown): ConnectIssue[] {
  const widgets = asWidgets(raw);
  const out: ConnectIssue[] = [];

  for (const [id, w] of Object.entries(widgets)) {
    if (typeof w.name !== "string" || !w.name.trim()) {
      out.push(issue(id, "name", "required"));
    }
    if (typeof w.description !== "string" || !w.description.trim()) {
      out.push(issue(id, "description", "required"));
    }
    if (typeof w.endpoint !== "string" || !w.endpoint.trim()) {
      out.push(issue(id, "endpoint", "required"));
    }

    const widgetType = typeof w.type === "string" ? w.type : "table";
    if (!WIDGET_TYPES.has(widgetType)) {
      out.push(
        issue(
          id,
          "type",
          `Invalid input (${widgetType}). Not in OpenBB widgets.json enum.`,
        ),
      );
    }

    if (w.staleTime !== undefined) {
      // Connect 2026-08-21: staleTime: 0 → "[staleTime]: Invalid input" (#355).
      // Docs give no min; Workspace's validator rejects non-positive numbers.
      const n = w.staleTime;
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
        out.push(issue(id, "staleTime", "Invalid input"));
      }
    }

    if (w.refetchInterval !== undefined) {
      const r = w.refetchInterval;
      if (r === false) {
        /* disable auto-refresh — allowed */
      } else if (typeof r === "number") {
        if (!Number.isFinite(r) || r < 1000) {
          out.push(
            issue(id, "refetchInterval", "Invalid input (minimum 1000 ms)"),
          );
        }
      } else if (typeof r === "string") {
        if (!isCron(r)) {
          out.push(issue(id, "refetchInterval", "Invalid input (cron string)"));
        }
      } else {
        out.push(issue(id, "refetchInterval", "Invalid input"));
      }
    }

    const wGrid = w.gridData?.w;
    const hGrid = w.gridData?.h;
    if (typeof wGrid !== "number" || wGrid < 1 || wGrid > 40) {
      out.push(issue(id, "gridData.w", "must be 1–40"));
    }
    if (typeof hGrid !== "number" || hGrid < 1 || hGrid > 100) {
      out.push(issue(id, "gridData.h", "must be 1–100"));
    }

    const params = Array.isArray(w.params) ? w.params : [];
    for (const [i, p] of params.entries()) {
      if (typeof p.paramName !== "string" || !p.paramName) {
        out.push(issue(id, `params[${i}].paramName`, "required"));
      }
      if (typeof p.type === "string" && !PARAM_TYPES.has(p.type)) {
        out.push(issue(id, `params[${i}].type`, `Invalid input (${p.type})`));
      }
      if (p.type === "endpoint" && typeof p.optionsEndpoint !== "string") {
        out.push(
          issue(id, `params[${i}].optionsEndpoint`, "required for type endpoint"),
        );
      }
    }

    if (widgetType === "multi_file_viewer") {
      const selector = params.find(
        (p) => Array.isArray(p.roles) && p.roles.includes("fileSelector"),
      );
      if (!selector) {
        out.push(
          issue(
            id,
            "params",
            "multi_file_viewer requires a param with roles: [\"fileSelector\"]",
          ),
        );
      }
    }
  }

  return out;
}

export function validateApps(
  apps: WorkspaceApp[],
  widgetIds: Set<string>,
): ConnectIssue[] {
  const out: ConnectIssue[] = [];
  const mention = /@\[id:([A-Za-z0-9_]+)\]/g;

  for (const app of apps) {
    const appId = app.name ?? "(unnamed app)";
    for (const [tabId, tab] of Object.entries(app.tabs ?? {})) {
      for (const item of tab.layout ?? []) {
        const wid = item.i;
        if (!wid || !widgetIds.has(wid)) {
          out.push(
            issue(appId, `tabs.${tabId}.layout`, `unknown widget ${wid ?? "(missing i)"}`),
          );
        }
      }
    }
    for (const g of app.groups ?? []) {
      for (const wid of g.widgetIds ?? []) {
        if (!widgetIds.has(wid)) {
          out.push(issue(appId, "groups.widgetIds", `unknown widget ${wid}`));
        }
      }
    }
    for (const prompt of app.prompts ?? []) {
      mention.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = mention.exec(prompt))) {
        const wid = m[1]!;
        if (!widgetIds.has(wid)) {
          out.push(issue(appId, "prompts", `unknown widget ${wid}`));
        }
      }
    }
  }
  return out;
}

export function formatConnectIssues(issues: ConnectIssue[]): string {
  return issues
    .map((i) => `${i.widgetId}: [${i.field}]: ${i.message}`)
    .join("\n");
}
