# agent-discipline

A portable behavioural skill for open-weights agents (Hermes, GLM, DeepSeek,
Qwen, Llama). It encodes the *process* that makes an agent trustworthy — orient
before claiming, verify before reporting, admit what failed — as an explicit
numbered procedure rather than as principles.

That distinction is the whole design. Frontier models infer good process from
terse rules. Smaller models follow an explicit procedure with checkable gates
far more reliably than they follow a principle, so every rule here is stated as
a step, paired with a contrastive ✗/✓ example, and given its reason (a stated
reason measurably improves retention across turns).

**It changes process, not reasoning depth.** It will not make a 7B model solve
what it cannot solve. It stops that model from *claiming* it solved it — which
is the failure that actually costs you time.

## Installing it

**Any harness that reads skill files** (opencode, Claude Code, most SKILL.md
loaders) — drop the folder in and it is picked up:

```sh
mkdir -p ~/.claude/skills
cp -r model-harness/skills/agent-discipline ~/.claude/skills/
```

Per-project instead of global: `.claude/skills/` in the repo root.

**Hermes, or anything you drive through a raw API loop** — strip the `---`
frontmatter and use the body as the system prompt, or append it to the one you
have:

```python
SYSTEM = pathlib.Path("agent-discipline/SKILL.md").read_text().split("---", 2)[2]
```

**Ollama** — put the same body in a `Modelfile`:

```
FROM hermes4
SYSTEM """<paste body here>"""
```

**LM Studio / OpenWebUI** — paste the body into the system prompt field.

## Tuning it

Treat the file as yours to edit. When your model fails in a way this does not
cover, add a rule in the same shape: **one step, one ✗/✓ pair, one sentence of
why.** Keep it tight — a skill that grows past a few hundred lines gets skimmed
by exactly the models that need it most.

The parity eval in `../parity/` tells you whether an edit actually helped:
`02-instruction-adherence` in particular measures whether a written rule
survives contact with a real task.
