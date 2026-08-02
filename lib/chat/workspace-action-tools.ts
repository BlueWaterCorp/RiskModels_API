/**
 * Workspace command-bus producer tools (G.36).
 *
 * Risk_Models's `action-bus.ts` is the authority on what the `.net` workspace
 * can execute. These tool schemas are GENERATED from an explicit, versioned
 * mirror of that vocabulary (`workspace-action-contract.mirror.json` — the
 * canonical file lives in Risk_Models at
 * `riskmodels_net/src/lib/workspace/workspace-action-contract.json`; the
 * `workspace-action-contract-drift.yml` workflow fails when the two differ).
 * Same cross-repo mechanism as the MCP schemas (`docs/AGENTS_CROSS_REPO.md`
 * §1–3), reversed: this repo holds the copy, not the source. Do NOT hand-edit
 * the mirror and do NOT hand-write these schemas — a manifest that offers more
 * than the bus performs recreates the "analyst describes actions it cannot
 * take" hole from the producer side.
 *
 * Execution model: these tools fetch nothing and bill nothing
 * (`capabilityId: null`). The executor's only job is to shape a typed
 * `WorkspaceAction`; the agent runners then emit it as a distinct `action`
 * SSE frame (see `stream-events.ts`), which `.net` proxies verbatim to the
 * workspace client. The client validates FAIL-CLOSED (`dispatchWorkspaceAction`)
 * and may refuse — the tool result says so explicitly so the model never
 * claims a change happened on its own authority.
 *
 * Offered only when the caller opts in (`workspace_tools: true` on the chat
 * body, sent by the workspace-mounted ChatAgent) — a chat with no workspace
 * attached must not be offered workspace switches it cannot perform. The
 * opt-in is honored on the streaming path only: the `action` frame is the
 * sole delivery channel, so offering the tools on the blocking JSON path
 * would emit actions nothing can receive.
 */

import { z } from "zod";
import mirror from "@/lib/chat/workspace-action-contract.mirror.json";
import { fnTool, type ChatToolDef } from "@/lib/chat/tools";
import type { ToolCallResult } from "@/lib/chat/tool-executor";

/* -------------------------------------------------------------------------- */
/* Mirror integrity — fail loudly at load, and again in tests                  */
/* -------------------------------------------------------------------------- */

const SUPPORTED = new Set<string>(mirror.supported_actions);
for (const required of ["set_subject", "set_window"] as const) {
  if (!SUPPORTED.has(required)) {
    throw new Error(
      `workspace-action-contract.mirror.json no longer lists "${required}" as supported — ` +
        "the Risk_Models bus dropped it. Remove the corresponding tool instead of offering " +
        "an action the bus refuses.",
    );
  }
}

const WINDOW_PRESETS = Object.keys(mirror.window_presets);
const SUBJECT_KINDS = [...mirror.subject_kinds];

if (WINDOW_PRESETS.length === 0 || SUBJECT_KINDS.length === 0) {
  throw new Error("workspace-action-contract.mirror.json is missing presets or subject kinds");
}

/* -------------------------------------------------------------------------- */
/* Args                                                                        */
/* -------------------------------------------------------------------------- */

const setSubjectArgs = z.object({
  subject_id: z.string().min(1, "subject_id required (the prefixed BW-… id)"),
  subject_kind: z.enum(SUBJECT_KINDS as [string, ...string[]]),
});

const setWindowArgs = z.object({
  preset: z.enum(WINDOW_PRESETS as [string, ...string[]]),
});

/** The payload an agent runner emits as a distinct `action` SSE frame. */
export interface EmittedWorkspaceAction {
  tool_call_id: string;
  action: Record<string, unknown>;
}

/**
 * Tool result shape: the action itself plus an explicit non-confirmation.
 * The workspace client is the validator of record; this side only dispatched.
 */
function dispatchedResult(action: Record<string, unknown>) {
  return {
    status: "dispatched_to_workspace",
    action,
    note:
      "Action handed to the workspace client, which validates it fail-closed and may " +
      "refuse it (e.g. unknown_subject when the subject is not loaded this session). " +
      "The workspace shows the user the outcome — do not state the change as fact.",
  };
}

function presetSummary(): string {
  return Object.entries(mirror.window_presets)
    .map(([preset, days]) => `${preset} = ${days} trading days`)
    .join(", ");
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export const WORKSPACE_ACTION_TOOLS_REGISTRY: ChatToolDef[] = [
  {
    name: "set_subject",
    openaiTool: fnTool(
      "set_subject",
      "Switch the riskmodels.net workspace to a subject ALREADY LOADED in this session " +
        "(the 13F filer, fund, or pasted portfolio on screen). The workspace client validates " +
        "fail-closed: naming any subject not already loaded is refused as unknown_subject and " +
        "nothing changes. Until roster integration ships the session holds exactly ONE subject, " +
        "so this can only confirm the subject already on screen — if the user asks to open a " +
        "different manager or fund, say it must be loaded in the workspace first; do not pretend " +
        "to switch.",
      {
        subject_id: {
          type: "string",
          description:
            "Prefixed workspace subject id already in this session, e.g. BW-FILER-0001067983 or BW-FUND-S000009228.",
        },
        subject_kind: {
          type: "string",
          enum: SUBJECT_KINDS,
          description: "The subject's kind, matching the id prefix (BW-FILER-… → filer_13f).",
        },
      },
      ["subject_id", "subject_kind"],
    ),
    capabilityId: null,
    argSchema: setSubjectArgs,
    executor: async (a) => {
      const args = setSubjectArgs.parse(a);
      return dispatchedResult({
        type: "set_subject",
        subject: { id: args.subject_id, kind: args.subject_kind },
      });
    },
  },
  {
    name: "set_window",
    openaiTool: fnTool(
      "set_window",
      `Change the riskmodels.net workspace's lookback window. ONLY these presets are performable: ${presetSummary()}. ` +
        "'max' equals '2y' today — 504 trading days is all the client fetches. If the user asks for a " +
        "window that is not offered (e.g. 3 years or 5 years), do NOT silently substitute another " +
        "window: tell them which windows are offered and let them choose.",
      {
        preset: {
          type: "string",
          enum: WINDOW_PRESETS,
          description: `Lookback preset: ${presetSummary()}.`,
        },
      },
      ["preset"],
    ),
    capabilityId: null,
    argSchema: setWindowArgs,
    executor: async (a) => {
      const args = setWindowArgs.parse(a);
      return dispatchedResult({
        type: "set_window",
        window: { preset: args.preset },
      });
    },
  },
];

export const WORKSPACE_TOOL_MAP: Record<string, ChatToolDef> = Object.fromEntries(
  WORKSPACE_ACTION_TOOLS_REGISTRY.map((t) => [t.name, t]),
);

export const WORKSPACE_CHAT_TOOLS = WORKSPACE_ACTION_TOOLS_REGISTRY.map(
  (t) => t.openaiTool,
);

/**
 * Pull the typed actions out of a round's tool results. Only successful
 * workspace-tool results carry one; errored calls (bad args) emit nothing —
 * the model already sees the structured arg error in the tool result.
 */
export function collectWorkspaceActions(
  results: ToolCallResult[],
): EmittedWorkspaceAction[] {
  const out: EmittedWorkspaceAction[] = [];
  for (const r of results) {
    if (!WORKSPACE_TOOL_MAP[r.name] || r.error) continue;
    const res = r.result as { action?: Record<string, unknown> } | null;
    if (res && typeof res === "object" && res.action) {
      out.push({ tool_call_id: r.tool_call_id, action: res.action });
    }
  }
  return out;
}

/** Appended to the system prompt when workspace tools are offered. */
export const WORKSPACE_TOOLS_SYSTEM_APPEND = `

## Workspace actions (this session only)

This chat is mounted inside the riskmodels.net workspace. The set_subject / set_window tools emit typed actions the workspace client validates and applies — they fetch no data. The client is fail-closed: it refuses subjects not already loaded this session (unknown_subject) and windows that are not offered. Never claim a workspace change took effect on your own authority — the workspace surfaces the applied/refused outcome to the user itself.`;
