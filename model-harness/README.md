# model-harness — running DeepSeek / GLM on Claude Code's harness

Goal: give the open-weights models the same skills, tools and agent loop Claude
Code uses, then find out how close they actually get.

> Separate concern from `seradex-ingress/` in this repo — it landed on the same
> branch because that is the branch this work is scoped to. Easy to split out.

## Setup — no proxy required

This is the part most write-ups get wrong. DeepSeek and Z.ai each publish a
**native Anthropic-compatible endpoint**, so there is no translating proxy, no
`ccf`/FCC/CLI-Proxy layer, and nothing to keep patched. It is environment
variables against the stock Claude Code install.

```sh
export DEEPSEEK_API_KEY=sk-...          # or ZAI_API_KEY
source model-harness/profiles/activate.sh deepseek
claude "..."                            # same skills, same tools, different brain
source model-harness/profiles/activate.sh claude   # back to baseline
```

| Profile | Base URL | opus→ | haiku→ |
|---|---|---|---|
| `claude` | *(default)* | — | — |
| `deepseek` | `https://api.deepseek.com/anthropic` | `deepseek-v4-pro` | `deepseek-flash` |
| `glm` | `https://api.z.ai/api/anthropic` | `glm-5.3` | `glm-5.3-flash` |

### Three things that will bite you

- **DeepSeek silently downgrades unknown model names to `deepseek-flash`.** Pass
  a model string it doesn't recognise and you get the cheap model with no error
  — you think you benchmarked V4 Pro and you benchmarked flash. The profiles set
  the model aliases explicitly for exactly this reason. Check
  `avg $/task` in the report: a suspiciously cheap "Pro" run is this.
- **DeepSeek's endpoint rejects the `system` role inside `messages`.** That is
  the mid-conversation system-message mechanism; anything relying on it fails
  rather than degrades.
- **Anthropic does not support this.** Verbatim from the gateway docs:
  *"doesn't support routing Claude Code to non-Claude models through any
  gateway."* Not prohibited — unsupported. Claude Code gains capabilities every
  release and a third-party endpoint that doesn't implement them breaks the
  corresponding features. `ANTHROPIC_BASE_URL` on a non-first-party host already
  disables MCP tool search by default.

Also worth knowing: while a gateway credential is set, your claude.ai
subscription is not used and its limits don't apply — so if you're on a
flat-rate plan, "cheaper" is measured against a bill you may not be paying.

## What actually transfers

The harness gives another model Claude's **context** — skills, `CLAUDE.md`,
tool definitions, the agent loop. It does not give it Claude's **capabilities**.
Concretely:

| Transfers cleanly | Does not transfer |
|---|---|
| `CLAUDE.md` and project rules | Holding those rules across 20 turns |
| `.claude/skills/*/SKILL.md` | Knowing *when* a skill applies without being told |
| Tool definitions and permissions | Recovering from a failed tool call |
| The prompt | Not fabricating a plausible answer when it should stop |

So parity isn't a config you reach — it's a gap you measure and then close by
**writing more explicit instructions**. Claude infers a lot from terse rules;
cheaper models need the same rules spelled out, with the failure mode named.
That is the actual work, and it's why the eval below exists.

## The parity eval

Three tasks, each scored by a script — no LLM judges another LLM here, because a
judge injects exactly the variance you're trying to measure.

| Task | What it stresses | Passes only if |
|---|---|---|
| `01-bugfix` | Reading code, not pattern-matching | Suite green **and** tests unmodified |
| `02-instruction-adherence` | Does `CLAUDE.md` actually steer it? | Function works **and** no floats in money code **and** explicit `ROUND_HALF_UP` |
| `03-multifile-refactor` | Long-horizon consistency | Zero stragglers of the old name **and** suite green |

`02` is the diagnostic one. A model that writes a working function using floats
**fails** — that is the whole point. The verifier parses the AST and rejects it,
because "produced working code" and "followed the project's rules" are different
questions, and only the second one predicts whether you can trust it on a ledger.

```sh
python model-harness/parity/run.py --profiles claude deepseek glm --repeat 3
python model-harness/parity/report.py model-harness/parity/results.json
```

`--repeat 3` matters: a single run tells you almost nothing, because run-to-run
variance on these models is larger than the gaps you're looking for.

The report prints a pass matrix, cost per task, turns, and a failure list. Read
that failure list as a to-do: **each failure is a skill to write.** When GLM
fails `02`, the fix isn't a different model — it's a `SKILL.md` that says "money
is `Decimal`, constructed from strings, quantized `ROUND_HALF_UP`; never
`float`" in a place the model reads at the right moment. Re-run and see if it
moved. That loop is "training them to be the same as Claude" in the only sense
the agent route offers.

## On your data

You chose the first-party endpoints, which is the right call for tuning the
harness on throwaway fixtures like these. Worth keeping deliberate: DeepSeek and
Z.ai are PRC-based, and the Talius work in flight — AP invoices, bank recs, GL
detail, an open audit — is a different risk profile from a rename-a-symbol
fixture. The same open weights are available from Western hosts if you later
point an agent at real ledger data; that's a base-URL change, not a rewrite.
