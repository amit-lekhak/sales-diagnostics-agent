# How to diagnose sales drops

Use the chat to explain a period drop with store contributors, company events, news, and weather overlap - without treating rain as the cause.

## Prerequisites

- App running (`pnpm db:seed` then `pnpm dev`)
- `GEMINI_API_KEY` set in `.env.local`
- Seed scenarios loaded (Mumbai July 2026 includes rain + ShieldGuard stockout)

## Steps

1. Open the Overview or Stores page and set the date filters you care about (or leave defaults).

2. Open **Ask sales**. Choose scope:
   - **This page** - keeps store / region / product filters from the URL
   - **All data** - company-wide unless the question names a place

3. Ask a diagnose question with a place and a window, for example:

   ```text
   Why did sales drop in July 2026 in Mumbai?
   ```

   Vague asks like “Why did sales drop?” with no place and no window (and no page store/region filter) get a clarify reply instead of tools.

4. Read the answer for:
   - Quoted `display` amounts (₹…), not invented USD
   - Store (or SKU) contributors from `explain_change`
   - Events / news (stockout, promo, port congestion) preferred over weather-as-cause
   - An unexplained remainder when the slice does not fully account for the change

5. Open **Trace / sources** on the assistant message to confirm tools such as `explain_change`, `list_context_events`, and `search_news`.

## Verification

For the seeded Mumbai July story you should see mentions of ShieldGuard / stockout and rain framed as overlap, not “rain caused it.” A follow-up like “So rain caused it?” should stay the analyst and deny pure causation.

## Troubleshooting

| Symptom                                             | Fix                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Fixed scope refusal about personas / weather itself | Question was out of scope; ask a sales/diagnostic question with a named window                  |
| Soft refuse: only Net sales / Units / AOV           | Ask one of those metrics, not margin / conversion / etc.                                        |
| Clarify for place and window                        | Name a store/city/region and dates, or set a store/region filter on the page with **This page** |
| Missing API key message                             | Set `GEMINI_API_KEY` in `.env.local` and restart `pnpm dev`                                     |
| Rate limit wait in the UI                           | Wait for the shown seconds (`retryAfterMs`) and retry                                           |

Related: [Explanation: Design decisions](explanation-design-decisions.md), [Reference: Runtime](reference-runtime.md).
