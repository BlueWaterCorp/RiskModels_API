# Landing Page Conversion Refactor

**Status:** In Progress  
**Created:** 2026-04-29  
**Goal:** Drive a single outcome-focused CTA while capturing developer/API conversions as a secondary path.

## Implementation Notes

- Copied `RiskWalkthroughChart` from `../Risk_Models/riskmodels_com/src/components/landing/` 
- Adapted for `.app` audience with dark theme, dual CTAs (primary user conversion + secondary dev/API path)
- Primary CTA: Yellow banner → `/get-key` 
- Secondary CTA: "Use this in your app or agent" → `/quickstart`
- **FIXED**: API endpoint corrected from `/api/landing-snapshot` → `/api/landing/walkthrough-chart`
- **FIXED**: Response parsing updated to handle `{ ticker, snapshot }` wrapper

---

## Objective

Convert users by showing immediate value ("explain returns"), then convert developers by letting them take that exact output into their app via API.

---

## 1. Hero Section

**Keep headline:**
> "See what you're actually betting on."

**Replace subheadline with:**
> "Know exactly what drove your returns — market, sector, or the stock itself."

**Primary CTA** (replace existing button):
> "Explain your portfolio's returns →"

**Subtext:**
> "Paste holdings or upload CSV. Private, instant explanation."

**Add secondary CTA** directly under primary (smaller, subtle):
> "or build this into your app →"

---

## 2. Transition to Example

Add above TSLA section:
> "Example — what actually drove TSLA's return:"

---

## 3. TSLA Section (Chart Unchanged)

**Add ABOVE the chart:**

Large summary:
> "TSLA is down -15.6% — driven by -20.7% stock-specific drag."

Small supporting line:
> "Market and sector added +5.1%. The loss came from the stock itself."

Keep chart unchanged.

---

## 4. Primary Action Under Example

Replace yellow box CTA text with:
> "Explain your portfolio →"

---

## 5. Developer/API Conversion (Critical)

Directly under the TSLA section (below CTA), add:

> "Use this in your app or agent → Get API key"

This should link to the API onboarding / key creation flow.

---

## 6. Remove Distractions

Delete the three feature cards:
- ❌ Seamless Model Integrity
- ❌ Structural Attribution  
- ❌ Tactical Risk Calibration

---

## 7. Replace with Single Value Section

**Title:**
> "What you get"

**Bullets:**
- See what actually drove your returns
- Separate market, sector, and stock-specific performance
- Identify hidden bets before they hurt you

---

## 8. Add Agent Hook

Below value section, add:

**Title:**
> "Ask your portfolio anything"

**Examples:**
- "What surprised me?"
- "Where am I overexposed?"
- "How do I reduce tech risk?"

---

## 9. Principles to Follow

- Lead with answer, not tool
- One primary CTA only
- All messaging must map to "explain returns"
- API is a secondary conversion path tied to the output
- No jargon (remove "decompose", "factor", "calibration" from first screen)
- Chart supports insight, not vice versa

---

## 10. API Page (If Linked)

Ensure API page opens with:

> `POST /explain`

Returns:
- return attribution (market / sector / subsector / residual)
- plain-English explanation
- optional hedge ratios

Do NOT lead with auth, pricing, or schema.

---

## End State User Flows

**User path:**
Landing → clicks "Explain your portfolio's returns" → sees output

**Developer path:**
Sees TSLA output → clicks "Use this in your app → Get API key"

---

## Notes

This is a conversion-focused refactor, not a visual redesign. Keep existing visual strength while tightening positioning and adding a real developer conversion path.
