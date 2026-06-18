# NoteTakerUI — Accounts & Billing Plan

> Status: **planning** — no implementation yet. This document is the agreed
> design for adding paid tiers on top of the existing Firebase Auth + Firestore
> stack. Provider: **Stripe** (direct), integrated via the Invertase
> *Run Payments with Stripe* Firebase extension.

## 1. Tier structure

| | **Anonymous** (pre-signup) | **Free** | **Base** | **Pro** |
|---|---|---|---|---|
| Sign-in required | No | Yes | Yes | Yes |
| Price | — | $0 | **$5/mo** | **$10/mo** |
| Cloud sync | No | Yes | Yes | Yes |
| Map limit | 1 (local) | 2 | 10 | Unlimited |
| Persistence | `localStorage`, no backup | Firestore | Firestore | Firestore |
| Stripe subscription | none | none | 1 price | 1 price |

- **Anonymous** is not a billed tier — it is the unsigned trial: 1 map,
  soft-persisted in `localStorage` (not discarded on close), no sync. Its only
  job is to convert visitors into free accounts.
- **Free** is the funnel bridge: a real account with sync, capped at 2 maps.
  It lowers the commitment to sign up before asking for a card.
- Stripe needs only **two products/prices** ($5 Base, $10 Pro). "Free" means
  signed in with no active paid subscription.

## 2. Stripe setup (dashboard, test mode first)

1. Create two **recurring** products: `Base – $5/mo`, `Pro – $10/mo`. Record each
   **price ID** (`price_…`).
2. Enable the **Customer Portal** so users can upgrade / downgrade / cancel
   themselves. Allow switching between the two prices.
3. Create a **webhook endpoint** pointing at the extension's function URL and
   capture the **signing secret**.
4. Do everything in **test mode** with test cards; switch to live keys at launch.

## 3. Firebase: Run Payments with Stripe extension

> Requires the **Blaze (pay-as-you-go)** plan — the extension runs Cloud
> Functions. The extension is Invertase/community-maintained; we accept that
> tradeoff for speed of delivery.

- Install `invertase/firestore-stripe-payments`.
- Configure: Stripe secret key, webhook secret, and enable
  **"sync products/prices to Firestore"**.
- It creates and maintains:
  - `customers/{uid}` — the Stripe customer
  - `customers/{uid}/subscriptions/{subId}` — active subscription, including its
    `price` ref and `status`
  - `products/{id}` and `products/{id}/prices/{id}` — synced catalog
- It exposes callables to **create a Checkout session** and a **portal link** —
  these back the upgrade and manage-billing buttons.

## 4. Tier resolution (the trustworthy read)

The client derives tier by reading `customers/{uid}/subscriptions` where
`status in ('active','trialing')` and matching its `price` ID:

```
$5 price       -> base   (limit 10)
$10 price      -> pro    (limit unlimited)
no active sub  -> free   (limit 2)
not signed in  -> anonymous (limit 1, local only)
```

Limits live in **one shared config constant** consumed by both the client and
the Cloud Function so they never drift.

## 5. Map-count enforcement (the one custom piece)

Firestore security rules cannot count documents in a collection, so:

- Maintain **`users/{uid}.mapCount`**, updated by a small **Cloud Function**
  (`onCreate` / `onDelete` of `users/{uid}/maps/{id}`). This is authoritative and
  cannot be spoofed by the client.
- **Security rules** gate creation against tier + count: read the subscription
  doc and `mapCount`, and allow a new map only if under the tier's limit.
  Tighten the existing `firestore.rules` accordingly.
- The UI also checks the limit for good UX, but the **rule is the real gate**.

## 6. Downgrade / cancellation policy

When a Pro user with, e.g., 25 maps drops to Base (10) or Free (2):

- **Never delete data.** Excess maps become **read-only / locked** (badge:
  "Upgrade to edit"), and **new-map creation is blocked** until back under the
  limit.
- Enforced the same way — rules check count vs. tier on write.
- Honor Stripe's `current_period_end`: keep paid access until the period ends
  (`cancel_at_period_end`); do not downgrade instantly on cancel click.

## 7. UI surfaces to build

1. **Pricing / upgrade screen** — three columns; "Upgrade" buttons call the
   Checkout callable.
2. **"Manage billing"** in settings — links to the Customer Portal.
3. **Limit-reached prompts** — contextual "You've hit your N-map limit ->
   Upgrade" when creating past the cap.
4. **Anonymous -> Free nudge** — "Sign in to sync & keep your notes."
5. **Tier badge** in the account menu.

## 8. Build sequence

1. **Phase 0 – Plumbing:** Blaze plan, install extension, Stripe test products;
   confirm a test subscription writes to Firestore.
2. **Phase 1 – Read path:** tier-resolution hook + shared limits config; show
   tier badge. No enforcement yet.
3. **Phase 2 – Checkout/portal:** upgrade screen + manage-billing button,
   end-to-end in test mode.
4. **Phase 3 – Enforcement:** `mapCount` Cloud Function + tightened
   `firestore.rules` + UI limit prompts.
5. **Phase 4 – Downgrade locking:** read-only excess maps, period-end handling.
6. **Phase 5 – Go live:** swap to live keys, real webhook, smoke test.

## 9. Open items

- **Free cap: 1 or 2 maps?** Currently assumed **2**.
- **Annual plans / free trial?** Easy to add later via extra Stripe prices.
- **Tax:** with Stripe-direct, you are the merchant of record and responsible
  for collecting/remitting sales tax/VAT. Acceptable to defer; revisit when
  selling internationally at scale (Paddle / Lemon Squeezy act as merchant of
  record and remove this burden).
