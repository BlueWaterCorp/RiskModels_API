export const BERKSHIRE_FILER_ID = "BW-FILER-CIK0001067983";

export const FINOS_WIDGETS = {
  rm_manager_skill_review: {
    name: "RiskModels — Manager Skill Review",
    description:
      "Backward-looking review of a public 13F filer: reported holdings, concentration, coverage, return attribution, risk decomposition and filing provenance. It does not rank managers or forecast skill.",
    category: "Manager Research",
    subCategory: "Public Filers",
    type: "html",
    endpoint: "widgets/manager-skill-review",
    gridData: { w: 40, h: 28 },
    source: ["SEC 13F", "RiskModels"],
    params: [
      {
        paramName: "bw_filer_id",
        type: "text",
        label: "Filer ID",
        description: "Canonical RiskModels filer ID. Berkshire Hathaway is the default public example.",
        value: BERKSHIRE_FILER_ID,
      },
    ],
    staleTime: 300_000,
    refetchInterval: false,
    exportable: false,
    raw: false,
    disableRetrievalForCopilot: true,
  },
} as const;

export const FINOS_APPS = [
  {
    templateId: "riskmodels-manager-skill-review",
    name: "Manager Skill Review",
    description:
      "Review a public manager's filed holdings, concentration, attribution, decomposed risk and evidence dates without a predictive ranking.",
    allowCustomization: true,
    tabs: {
      review: {
        id: "review",
        name: "Review",
        layout: [
          {
            i: "rm_manager_skill_review",
            x: 0,
            y: 0,
            w: 40,
            h: 28,
            state: { params: { bw_filer_id: BERKSHIRE_FILER_ID } },
          },
        ],
      },
    },
    groups: [],
    prompts: [],
  },
] as const;
