# AI Closer — on-prem reconciliation copilot for Excel

A spreadsheet copilot for accountants. It reads a credit-card statement export,
runs a **deterministic reconciliation engine** (tie-outs, GST consistency,
suspense, cross-foot checks), surfaces every mismatch as a **reviewable flag**,
and optionally **drafts** journal coding using a small, cheap **BYO-key** model.

The engine **never silently balances.** It flags, it parks ambiguity in Suspense,
and it drafts — a human confirms before anything posts. That discipline is the
product: it's the difference between a tool that hides errors and one that
surfaces them.

Built as an **Office JavaScript Add-in** (React + TypeScript), with the entire
core extracted as pure, unit-tested modules that run without Office.

---

## Why this exists

Senior accountants spend their week in the same three loops: reconcile the bank,
clean up the credit card, explain the variance. These are *deterministic* jobs
wrapped in *judgment* calls — which vendor codes to what GL, is this refund the
same charge, is this vendor's GST treatment actually stable.

This project is the exact division of labor:

| Concern | Owner | Example |
|---|---|---|
| Math, sums, tie-outs, minute precision | **Engine** (deterministic, tested) | per-card sum vs statement, `gross×5/105` |
| Cross-cutting rules | **Engine** | 4-month GST consistency gate |
| Don't guess | **Engine** | ambiguous row → Suspense `#9999-99` |
| Judgment / drafts | **LLM** (BYO-key) | normalize an ambiguous vendor, suggest a GL code |
| Never fabricate | **Both** | every model draft is re-validated by the engine |

The LLM is a **narrow draft layer**, never an authority. You bring your own
OpenRouter key and pick a cheap model — and because it's BYO-key, confidential
ledger data never rides a shared subscription.

## Current status

- ✅ **Engine** — full implementation, **12/12 unit tests green**, `tsc` clean
- ✅ **Model layer** — OpenRouter `chat/completions` with JSON-mode GL-code drafts
- ✅ **Taskpane** — React UI, runs live in a plain browser on a demo dataset
- ✅ **Bundle** — esbuild produces `dist/` (js + css) for sideload
- 🔶 **Office sideload packaging** — manifest present; serve over https + icons TODO

### Verified

```sh
npm test        # 12 passing — engine against the Talius CC recon spec rules
npm run typecheck  # 0 errors (strict)
npm run build   # bundles dist/taskpane.{js,css}
```

The `src/office` adapters and manifest are scaffolded but not exercised in CI
(no Office host on the runner). The engine they feed is fully tested.

## Quick start — run the live demo (no Office needed)

```sh
npm install
npm run build
npx serve dist        # or: python -m http.server 8137 --directory dist
# open http://localhost:8137/taskpane.html
```

The taskpane renders on a realistic Talius-style card month:
`0807 Cal`, `3474 Frank`, `9494 Greg`, `9583 Greg`, `7878 Frank`, `2169 Rares`.
Watch the engine produce per-card tie-outs, a zero variance, a GST consistency
note (Shaw, Adobe qualify; Anthropic/US and one-offs don't), a refund routed to
Other credits, a skipped $0 placeholder, and one `DUBLIN` charge parked in
Suspense — which you can then tell the model to draft.

## Architecture

```
manifest.xml              Office Add-in manifest (sideload)
src/
  engine/                 pure TS, no deps, fully unit-tested
    types.ts              cents-exact domain model
    mapping.ts            last-4 → cardholder
    gst.ts                4-month GST consistency gate
    coding.ts             cross-foot (Check) math
    recon_math.ts         O(n+m) amount matching with row provenance
    parsing.ts            filthy-export amount parsing → integer cents
    reconciler.ts         orchestrator: tie-outs, credit detect, suspense, variance
    index.ts
  model/
    client.ts             BYO-key OpenRouter client: tool calling + streaming
    tools.ts              tool schemas + system prompt handed to the model
    openrouter.ts         JSON GL-code drafts
  office/
    executor.ts           runs a tool call; host-agnostic, unit-tested
    excelHost.ts          the only code that touches Excel (structural types)
  taskpane/
    agent.ts              the tool-calling loop
    App.tsx               React UI — streaming, tool cards, diff approval
    markdown.tsx          renders replies as React elements (no innerHTML)
    reconcile.ts          two-column reconcile with true worksheet rows
    demo.ts               realistic card month used by the demo
    index.{tsx,css} App.css
  commands/               manifest FunctionFile stub
tests/                    87 tests
scripts/
  build.mjs               esbuild bundle of taskpane + commands entries
```

### How a turn works

The add-in does not guess intent from keywords. The model is given the tools in
`model/tools.ts` and picks; `taskpane/agent.ts` executes what it asked for, feeds
the results back, and repeats until the model answers.

Two invariants hold regardless of what the model says:

- **It cannot do the arithmetic.** Reconciliation and duplicate detection run in
  `engine/`, exposed as tools. The model reports returned numbers; it never
  computes them.
- **It cannot write to the sheet.** `propose_write` stages a diff. Nothing
  reaches a cell until the user clicks Apply.

The engine's rules encode Talius's real company conventions — most notably the
**GST rule**: claim GST *only* for vendors whose treatment has been consistent
for **≥ 4 consecutive months**; everything else (one-off restaurants, transport,
flights, hotels, first-time and foreign/US vendors) gets none, regardless of
conventional taxability.

## Install & run in Excel

Everything needed is wired up. On this machine the system CA already trusts the
localhost cert and the server runs on `https://localhost:3000`.

```sh
npm run build     # typecheck + icons + bundle dist/
npm run serve     # HTTPS server on https://localhost:3000 with the localhost cert
```

Then sideload the add-in into Excel. The shared-folder catalog is the most
reliable path (works regardless of whether the newer "Apps" store shows an
Upload button in your build):

```sh
# one-time: point Excel at a folder that lists your add-in manifests
scripts/setup-shared-folder.bat   # or run the reg add it performs
mkdir -p manifests && cp manifest.xml manifests/   # folder already has it
```

Then in Excel:
1. **File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs**
2. Under "Categories/Trusted catalogs", check **Catalog URL** that points to the
   `manifests` folder, and enable **"Show in Menu"**
3. Restart Excel → **Home → Add-ins → My Add-ins** → the **AI Closer** taskpane
   is listed → click it.

The add-in fetches `https://localhost:3000/taskpane.html` (trusted cert) and
mounts the taskpane on `Office.onReady`.

> The add-in also runs as a standalone web demo in any browser at
> `https://localhost:3000/taskpane.html` (no Office required) — Office.js is
> loaded from the CDN but the dual-mode bootstrap skips `Office.onReady` when
> no host is present.

**First-time cert setup** (already done here, but for a fresh clone):

```sh
npm i -D office-addin-dev-certs
npx office-addin-dev-certs install   # generates + trusts localhost cert
npm run serve                        # reuses ~/.office-addin-dev-certs/
```

> Note: `office-addin-dev-certs` needs to write the CA cert into the system
> trust store (admin elevation on Windows) the first time.

## Models & cost

BYO key, pick a cheap model. Default is `deepseek/deepseek-v3-0724`; the
prompt-token cost for a full card month is pennies. The draft layer is scoped
to the handful of suspense/ambiguous rows, not the whole ledger.

## Prior art

Two earlier sketches of the OpenRouter-in-Excel plumbing live in `references/`
(kept as reference, not part of the build):
- `references/OpenRouterExcel.bas` — VBA UDFs, `=OPENROUTER_CHAT(...)` via WinHTTP
- `references/OpenRouterOfficeScript.ts` — Office Script, built-in `fetch`, free Nemotron

This repo is the productized version: those proved the pipe; this adds the
engine, the rules, and the shell.

## License

MIT