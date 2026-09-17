# Behavioural skills for open-weights agents

Two skills, same goal, different amounts of scaffolding. **Install one, not
both** — they cover the same ground and stacking them just burns context.

| Your model | Install | Why |
|---|---|---|
| Hermes, GLM 5.3 Flash, Qwen, Llama, anything ≤ ~70B | **`agent-discipline`** | Needs the explicit procedure |
| Nemotron 3 Ultra, DeepSeek V4 Pro, GLM 5.3, Kimi | **`agent-integrity`** | Has the procedure; needs the standard |

## The difference

Both encode what makes an agent trustworthy: orient before claiming, verify
before reporting, admit what failed.

**`agent-discipline`** (144 lines) states it as a numbered procedure with
checkable gates, a ✗/✓ pair per rule, and a closing checklist. Smaller models
follow an explicit procedure far more reliably than they follow a principle, and
a stated reason measurably improves whether a rule survives across turns.

**`agent-integrity`** (81 lines) drops all of that and keeps only the standard.
A capable model already decomposes tasks well; handing it a rigid five-step loop
displaces its own judgement with your ritual and measurably *reduces* output
quality. This is the same lesson frontier labs document for their own models —
prompts written for weaker predecessors are usually too prescriptive.

What survives into the lean version is everything that is **policy rather than
scaffolding**: evidence before claims, no fabricated values, hold the project's
rules for the whole session, edit rather than rewrite, report what failed. No
amount of capability makes a model volunteer "this is unverified" on its own.

**Neither changes reasoning depth.** They will not make a model solve what it
cannot solve. They stop it from *claiming* it solved it — which is the failure
that actually costs you an afternoon.

## Nemotron 3 Ultra — two config notes

Worth getting right, because they interact with the skill:

- **Turn the reasoning trace on** (`enable_thinking=True` in the chat template).
  For agentic work it is the point of the model, and a complex task's trace runs
  2k–8k tokens before the final answer. Budget output tokens accordingly.
- **Do not also write "think step by step" into your prompt.** With a native
  reasoning trace that is redundant at best, and at worst you get reasoning
  duplicated into the visible answer. `agent-integrity` deliberately contains no
  CoT prompting for this reason.

With 1M context and Ruler holding at that length, you can afford to load whole
files rather than grep-and-hope — which is the cheapest reliability win
available and removes most of the situations that tempt a model to guess.

## Installing it

**Any harness that reads skill files** (opencode, Claude Code, most SKILL.md
loaders) — drop the folder in and it is picked up:

```sh
mkdir -p ~/.claude/skills
cp -r model-harness/skills/agent-integrity ~/.claude/skills/   # or agent-discipline
```

Per-project instead of global: `.claude/skills/` in the repo root.

**Hermes, or anything you drive through a raw API loop** — strip the `---`
frontmatter and use the body as the system prompt, or append it to the one you
have:

```python
SYSTEM = pathlib.Path("agent-integrity/SKILL.md").read_text().split("---", 2)[2]
```

**Ollama** — put the same body in a `Modelfile`:

```
FROM hermes4
SYSTEM """<paste body here>"""
```

**LM Studio / OpenWebUI** — paste the body into the system prompt field.

## Tuning it

Treat the files as yours to edit. When your model fails in a way they do not
cover, add a rule in the same shape as its neighbours — a step with a ✗/✓ pair
in `agent-discipline`, a bare standard in `agent-integrity`.

Resist growing the lean one. If you find yourself adding procedure to
`agent-integrity`, first check whether the model actually needed it or whether
one bad run spooked you; over-constraining a capable model is the specific way
this gets worse rather than better.

The parity eval in `../parity/` tells you whether an edit actually helped:
`02-instruction-adherence` in particular measures whether a written rule
survives contact with a real task.
