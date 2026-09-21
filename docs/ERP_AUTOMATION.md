# Automating Seradex without babysitting the cursor

**Status:** in progress — SQL access confirmed, schema mapping next
**Decision owner:** Antonio
**Setup guide:** [`SERADEX_SETUP.md`](./SERADEX_SETUP.md)

> **Update:** a test copy of the ERP database (`ActiveM_Talius_Test`) already
> exists on `HOSTED05\SQL19`, so the sandbox question below is answered. The
> dedicated laptop is **deferred** — see [Do we need the second laptop?](#do-we-need-the-second-laptop)

---

## The problem

Every automation attempt against Seradex so far has needed a human to hold the
mouse still. That is the tell for **coordinate-based automation** — the script
clicks at pixel `(840, 312)` rather than at "the *Save* button". Any change in
window size, screen resolution, DPI scaling, or scroll position breaks it, and
a stray cursor move can land a click somewhere it shouldn't.

Coordinates are the fragile layer. Everything below is about removing that layer.

---

## Four approaches, most to least robust

### 1. Skip the GUI — go to the data

Seradex is a Windows client over **Microsoft SQL Server**. A read-only SQL login
means an agent can learn the schema by querying it directly: POs, invoices,
vendors, GL accounts. No mouse involved, nothing to break when a screen is
redesigned, and it's orders of magnitude faster than screen-scraping.

- **Reads:** direct SQL. This is the right answer for lookups, reconciliation,
  and any "what does the ERP think the balance is" question.
- **Writes:** *not* direct SQL. Seradex maintains its own referential integrity
  and audit trail; inserting rows behind its back will corrupt both. Use the
  built-in import tools or the API module — licensing dependent.

> **Assumption to confirm:** that Seradex here is the SQL Server-backed product
> and that our license permits a read-only login. Both need confirming with the
> admin before any of this is real work.

### 2. Element-based GUI automation for what's left

For workflows with no data-layer equivalent, target UI elements by their
**Windows UI Automation** identifiers rather than their position:

| Tool | Cost | Notes |
|---|---|---|
| Power Automate Desktop | included with Win 10/11 | has a recorder — capture a flow once, then edit the steps |
| `pywinauto` | free (Python) | scriptable, version-controllable, fits alongside this repo |

Both address `Button "Save"` instead of `(840, 312)`. Window size, resolution
and mouse position stop mattering. **This is where the "holding the cursor"
problem actually goes away.**

Note that once a flow is built it needs no AI at runtime — it just runs. The
model is only involved while authoring.

### 3. A computer-use agent on the dedicated laptop

An agent that takes screenshots and drives the mouse itself (Claude Cowork on
desktop, or the computer-use API). On a machine nobody else is using, it can be
handed a task and left alone — that's what the dedicated laptop buys us.

Slower and less reliable than 1 and 2. Right for **exploring** unfamiliar screens
and for one-off jobs that will never be worth scripting. Wrong for anything on a
schedule.

### 4. Teach it from documentation, not demonstration

Short screen recordings plus written steps — field names, the order screens must
be visited in, the gotchas — handed to the agent as a skill or SOP file. Five
minutes of notes saves hours of the agent wandering and guessing wrong.

---

## "Can't it just learn by poking at it, like a Rubik's cube?"

Partly. Two corrections matter:

**It doesn't retain anything on its own.** The model's weights don't change from
exploring. Every session starts cold. So the useful version is: have the agent
click around **and write its own notes as it goes** — which menu leads where,
what each field means, the step order for each workflow. That file, read at the
start of every future session, *is* the learning. Without it, the exploration
evaporates.

**A live ERP is not a Rubik's cube.** Fiddling with a cube costs nothing. Fiddling
in Seradex can post an invoice, mutate a vendor record, or approve a PO. Before
any exploration:

- Point it at a **test/training company database** if one exists — many Seradex
  installs have one. Ask the admin.
- If there isn't one, create a **view-only login** for the exploration phase.
- Instruct it explicitly: never save, post, or approve anything while exploring.

Also: Cowork runs Claude, not DeepSeek — going that route makes the model
question moot.

---

## On running DeepSeek for this

Kept here because it came up, with the caveats it needs:

- **It won't run on the laptop.** The Flash variants still need server-class RAM
  for even the smallest quantization. It would be an API call; the laptop just
  runs the automation.
- **Hosting location is a data-governance question.** DeepSeek's first-party API
  is hosted in China. Vendor names, invoice amounts and potentially banking
  details would leave the country. That needs sign-off from whoever owns IT and
  data policy at Talius — not a decision to make inside a script. A US-hosted
  provider serving the same open weights, with zero data retention, is the
  cleaner path if the model is wanted.
- **Where it would fit:** behind a SQL/scripting agent, where it's cheap and
  competent. Not as a hand-rolled computer-use harness — purpose-built agents
  are more reliable there for less work.

> ⚠️ Specific figures quoted in the originating conversation (parameter counts,
> RAM floors, which hosts and agent frameworks support which version) were not
> verified and move fast. Re-check them against the provider's own docs before
> anyone budgets on them.

---

## Recommended setup

| Layer | Tool | Used for |
|---|---|---|
| Reads & reconciliation | read-only SQL login | lookups, tie-outs, "what does the ERP say" |
| Repeatable data entry | Power Automate Desktop / `pywinauto` | the scheduled, high-volume workflows |
| Everything else | computer-use agent on the dedicated laptop | exploration, one-offs, odd jobs |
| Institutional memory | a skill/SOP file per workflow | so no session starts from zero |

Sequenced: **sandbox or read-only login first**, then let the agent explore
*one* workflow (invoice entry is the obvious first), have it write the notes,
**review those notes yourself** before trusting it with anything real.

---

## Next steps

Questions for the Seradex administrator — none of the above is actionable until
these are answered:

1. Can we get a **read-only SQL login**? (SQL in `SERADEX_SETUP.md`)
2. ~~Is there a test / training company database?~~ — **yes, `ActiveM_Talius_Test`.**
   Still worth asking how recently it was refreshed from production.
3. Does our license include the **import tools or API module** for writes?
4. Is `ActiveM_Seaton` a related Talius entity or a separate client?

Then, on the machine you already have:

- [ ] Create the read-only login and prove it can't write
- [ ] Connect a local agent session (`sqlcmd` to start, MCP after)
- [ ] Map the AP/PO data model against the test database, agent writing notes
- [ ] Review those notes, correct them, commit as the first workflow skill
- [ ] Wire an extract into the `aireconciler` engine

## Do we need the second laptop?

Not yet. Of the four approaches, only the computer-use agent genuinely requires
dedicated hardware — it takes over the mouse and keyboard, so the machine can't
be used for anything else while it runs. That is also the **least** valuable of
the four.

SQL reads are headless and run in the background. Element-based automation
mostly does too. Both work on the machine you're already sitting at.

The laptop becomes worth buying when a specific workflow has no data-layer path
**and** has to run unattended or on a schedule. Revisit then, with a concrete
job to size it against.

---

## Relationship to this repo

`aireconciler` is the Excel-side half of the same job: it reconciles statements
once the data is *in* a spreadsheet. The work above is about getting data out of
Seradex reliably in the first place — upstream of the engine, same overall goal
of replacing manual keying with something deterministic and reviewable. The
design discipline carries over: **the machine flags and drafts, a human confirms
before anything posts.**
