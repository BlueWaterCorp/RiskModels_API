# Prepaid-credit receipts

Every prepay purchase on riskmodels.app (Stripe Checkout, payment mode, $25 / $50 / $100)
emails the buyer a receipt. Before 2026-09-16 nothing did: Stripe's own receipt was off
(no `receipt_email` on the PaymentIntent) and the crediting handler sent no mail.

## Flow

```
Checkout (payment mode)
  └─ success redirect  ──┐
  └─ checkout.session.completed webhook ──┤  both call GET /api/stripe/setup-success
                                          ▼
                      credit balance (idempotent per PaymentIntent via balance_top_ups)
                                          ▼  first credit only
                      lib/agent/prepaid-receipt.ts → sendEmail("prepaid-receipt")
                                          ▼
                      Resend  →  buyer  (+ audit BCC, see lib/resend-audit.ts)
                      email_logs row (email_type = 'prepaid-receipt', status sent|failed)
```

- Template: `emails/prepaid-receipt.tsx` (receipt number, issuer / billed-to, line item and total, payment method, cardholder, statement descriptor, balance after credit,
  PaymentIntent reference). It is the receipt of record; Stripe's hosted page is not linked.
- Subject: `Receipt RM-20260916-PLCDBA: $100.00 RiskModels API credit` (number = RM-<UTC date>-<PaymentIntent tail>, deterministic per purchase).
- The send is best-effort and happens after the ledger writes; a failure never blocks
  crediting and is recorded in `email_logs` for re-issue.
- Only one receipt per PaymentIntent: the send lives inside the branch that runs on the
  first credit, so the redirect + webhook double-delivery cannot mail twice.
- Crediting also clears `agent_accounts.low_balance_notified_at`, re-arming the one-shot
  low-balance alert.

## Re-send / backfill

`POST /api/admin/billing/receipt` (Bearer `CRON_SECRET`, prod value in Doppler `erm3/prd`):

```bash
doppler run -p erm3 -c prd -- bash -c '
curl -sS -X POST "https://riskmodels.app/api/admin/billing/receipt" \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d "{\"payment_intent_id\":\"pi_…\",\"dry_run\":true}"'
```

Body fields: `payment_intent_id` (required), `to` (override recipient), `balance_after_usd`
(override the balance shown — default is the account's current balance), `dry_run`.

The PaymentIntent must already have a `completed` row in `balance_top_ups`; the endpoint
never credits. Find candidates that were credited but never receipted:

```sql
select t.stripe_payment_intent_id, t.user_id, t.amount_usd, t.created_at
from balance_top_ups t
left join email_logs e
  on e.user_id = t.user_id
 and e.email_type = 'prepaid-receipt'
 and e.status = 'sent'
 and e.subject like '%' || to_char(t.amount_usd, 'FM999990.00') || '%'
where t.status = 'completed' and e.id is null
order by t.created_at desc;
```

## Checks

- `email_logs` — one `prepaid-receipt` row per purchase, `status = 'sent'`.
- Resend dashboard → Emails, or the audit BCC mailbox (`resend@riskmodels.app`).
- Stripe Dashboard → Payments → PaymentIntent → "Receipt history" stays empty: RiskModels,
  not Stripe, sends the receipt. Do not also turn on Stripe's "Successful payments" email,
  or buyers get two. Card details and tax lines stay on Stripe's side; the receipt names the
  cardholder and the statement descriptor so the buyer can match the charge.
