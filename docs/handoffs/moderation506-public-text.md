# Handoff · Issue #506 · MOD-V2-A public text (author pass 6 · actualprovider batch contract)

Bounded repair on frozen base
`3e62b19a2a7c4ae177a175d89f34ea3aa985812a` (OWNER506_A_ACTUAL_PROVIDER_BATCH_CONTRACT_FIX,
attempt 6). Prior pass-5 location eligibility and earlier game-authority /
actor/session/caps/replay preflight repairs remain accepted. No DONE / QA /
CI / DEV / UAT claims from this source pass.

## Proven transport failure (parent DEV probe)

Parent ran exactly one authorised safe synthetic DEV transport probe
(no private text, approval writes, or app publication). Evidence:
`text-batch-transport-once.json` (sha256
`0f21e719ef2fd422bdcb376b9a40db4212da38eb9a4e7f7aee6ea28af5a823a1`).

Wire format under test: current candidate
`array_of_text_objects` — `input: [{type:"text",text}, …]` for **two**
fields.

Actual provider response:

- `http_status`: 200
- `response_model`: `omni-moderation-2024-09-26` (pinned)
- `result_count`: **1** (not 2)
- `flagged`: `[false]`

So multimodal-shaped text object arrays are **one** combined moderation
request, not an independent text batch. `parseTextResponse(raw, expected=2)`
then throws schema → public multi-field updates surface as **503**.
Prior unit fixture that returned two results while asserting
`item.type === "text"` masked the wrong wire format; that failure evidence
is preserved here and must not be treated as historical PASS.

Official primary create contract:
https://developers.openai.com/api/reference/resources/moderations/methods/create
— `input string[]` for independent text batch vs multimodal `object[]`.

## Pass-6 concrete repair

1. `openai-provider.ts` — `moderateTexts` now sends
   `input: Array.from(input.texts)` (ordinary `string[]`, exact order/count).
   Image multimodal payload, pinned model, strict
   `parseTextResponse(..., expected)`, budgets/deadline/retry/error
   handling unchanged. No collapse of fields into one decision; expected
   result cardinality remains `texts.length`.

2. `text-moderation.test.ts` — adapter mock asserts exact `string[]`
   payload equal to the batch texts, rejects multimodal-shaped
   `{type:"text"}` batch items, and still requires response
   cardinality/strict parsing (fixture length 2 for two inputs).

## Author sandbox status

- Edits limited to allowed paths only (openai-provider + text-moderation
  unit test + this handoff).
- No live provider/network, credentials, Git, runtime, or root used here.
- Affected unit tests and corrected positive safe probe on installed
  adapter are for parent later; independent delta QA / Product CI / DEV
  not claimed.
- Pass-5 location source unchanged; no other code/architecture/deps/
  releases.
- Attempts / FAIL / UNKNOWN / model route costs preserved; no fake
  all-PASS / DEV claim.

## Parent next (exact)

```bash
# From CLEAN repo after trusted integrate of pass-6 paths:
cd apps/api
pnpm exec vitest run test/unit/text-moderation.test.ts
# Then one authorised corrected safe synthetic DEV string[] probe
# (expect HTTP200 + model pinned + results.length === requested_inputs)
# Then independent delta QA → Product CI → DEV (UAT=NOT_TESTED)
```

Focus checks for delta QA:

- Text-only batch wire body is `string[]` in exact input order
- Multimodal `{type:"text"}` object batch is not used for text-only
- `parseTextResponse` still requires `results.length === texts.length`
- Image moderation request shape unchanged
- Prior location eligibility preflight (pass 5) untouched

## Still not claimed

- Overall PASS/DONE from source author
- Independent QA / Product CI / DEV ACCEPTED
- Corrected live probe success (parent owns)
- Mode B binding / AGY author / PROD
