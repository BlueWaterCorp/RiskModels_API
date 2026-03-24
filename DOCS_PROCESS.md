# Process: Adding New Documentation

This document describes how to add new docs to the RiskModels API developer portal and keep them in sync.

---

## Quick Reference

| Step | Action |
|------|--------|
| 1 | Create or update source markdown (e.g. `PLAID_HOLDINGS_UX.md`) |
| 2 | Add `content/docs/{slug}.mdx` for the web portal |
| 3 | Add link from `content/docs/api.mdx` (or other hub) if needed |
| 4 | Optionally add to Navbar if it's a top-level doc |
| 5 | Update `README.md` or `README_API.md` if it's a core doc |

---

## 1. Source Markdown

**Location:** Repo root or `docs/` (e.g. `PLAID_HOLDINGS_UX.md`, `AUTHENTICATION_GUIDE.md`)

- Use for: canonical reference, GitHub README links, external docs
- Format: Standard Markdown
- No frontmatter required unless you want it for tooling

---

## 2. Web Portal MDX

**Location:** `content/docs/{slug}.mdx`

**Required frontmatter:**
```yaml
---
title: Page Title
description: Short description for SEO and nav
---
```

**Slug → URL mapping:**
- `content/docs/plaid-holdings.mdx` → `/docs/plaid-holdings`
- `content/docs/api.mdx` → `/docs/api` (default for `/docs`)

**Content:**
- Use standard Markdown; MDX allows JSX (e.g. `<div className="...">`) for custom layouts
- Use the same "Related" card grid pattern as other docs for consistency

**Example Related section:**
```mdx
## Related

<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 not-prose">
  <a href="/docs/authentication" className="group flex flex-col gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 hover:border-primary/50 hover:bg-zinc-900 transition-all">
    <span className="font-semibold text-zinc-100 group-hover:text-primary transition-colors text-sm">🔐 Authentication</span>
    <p className="text-xs text-zinc-500">Bearer tokens and OAuth2.</p>
  </a>
  ...
</div>
```

---

## 3. Add to Docs Hub

If the new doc should appear on the main API docs page:

**File:** `content/docs/api.mdx`

Add a card to the grid (around line 10–75):

```mdx
<a href="/docs/plaid-holdings" className="group flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 hover:border-primary/50 hover:bg-zinc-900 transition-all">
  <div className="flex items-center gap-3">
    <span className="text-xl">🏦</span>
    <span className="font-semibold text-zinc-100 group-hover:text-primary transition-colors text-sm">Plaid Holdings</span>
  </div>
  <p className="text-xs text-zinc-500 leading-relaxed">How to connect brokerage accounts and fetch holdings via the API.</p>
</a>
```

---

## 4. Add to Navbar (Optional)

If the doc should appear in the main nav:

**File:** `components/Navbar.tsx`

Add to `navLinks`:
```tsx
{ href: '/docs/plaid-holdings', label: 'Plaid' },
```

---

## 5. Update README / Documentation Table

If it's a core doc that should be listed in the repo README:

**File:** `README.md` or `README_API.md`

Add to the Documentation table:
```markdown
| [PLAID_HOLDINGS_UX.md](PLAID_HOLDINGS_UX.md) | Plaid connection flow and holdings API UX |
```

---

## 6. Verify

1. **Build:** `npm run build` — ensures MDX compiles
2. **Dev:** `npm run dev` — visit `http://localhost:3000/docs/plaid-holdings`
3. **Links:** Click through Related cards and hub links to ensure they work

---

## File Checklist

When adding a new doc (e.g. "Plaid Holdings UX"):

- [ ] `PLAID_HOLDINGS_UX.md` (or equivalent) — source markdown
- [ ] `content/docs/plaid-holdings.mdx` — web portal page
- [ ] `content/docs/api.mdx` — add link card if it's a hub doc
- [ ] `components/Navbar.tsx` — add nav link if top-level
- [ ] `README.md` — add to Documentation table if core

---

## Ownership

**RiskModels_API owns all documentation files directly.**

Edit these files in this repo:
- `API_TERMS.md`
- `notebooks/riskmodels_quickstart.ipynb`
- `OPENAPI_SPEC.yaml` (canonical spec; generates `openapi.json`)

---

## Example: Plaid Holdings UX

**Completed steps:**

1. `PLAID_HOLDINGS_UX.md` — created
2. `content/docs/plaid-holdings.mdx` — created
3. Link added to `content/docs/api.mdx` — (add if desired)
4. Navbar — optional
5. README — add to Documentation table

See `PLAID_HOLDINGS_UX.md` and `/docs/plaid-holdings` for the result.
