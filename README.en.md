[Русский](README.md) · **English**

# `open(space)`

**A shared thinking environment for humans and AI agents.**

```text
████ ████ ████ █  █    █   ████ ████ ████ ████ ████   █
█  █ █  █ █    ██ █   █    █    █  █ █  █ █    █       █
█  █ ████ ███  █ ██   █    ████ ████ ████ █    ███     █
█  █ █    █    █  █   █       █ █    █  █ █    █       █
████ █    ████ █  █    █   ████ █    █  █ ████ ████   █
```

[Concept](docs/concept.md) · [Architecture](docs/architecture.md) · [Evidence](docs/dynamics.md) · [Changelog](CHANGELOG.md) · [Backlog](docs/todo.md) · [Русский](README.md)

Not a chat with several models. A space for one task: you invite the minds it needs, you decide
how exactly they should work together, and the conversation leaves behind more than a transcript.

```text
open(product_strategy)
research(market)
roast(pricing)
brainstorm(naming)
premortem(launch)
```

They explore independently, disagree, test each other's arguments and assemble a decision.
The human decides.

```bash
git clone https://github.com/gh0stcreator/openspace && cd openspace
cd web && npm install && cd ..
npm run dev            # localhost:4477
```

You need `node` 20 or newer and `claude` and `codex` installed and logged in — the product asks
for no keys of its own.

---

## Manifesto

Most AI products today are built around a conversation with one general intelligence.

Open a chat. Ask a question. Get an answer. Clarify. Close the tab.

For many tasks that is enough. For hard work it is not.

Strategy, product, research, writing and reviewing decisions rarely need one right answer. They
need different ways of thinking: to explore, to invent, to doubt, to attack an argument, to find
a contradiction, to compare options and to decide.

The product's main hypothesis:

> **A team of specialised agents, working in an explicitly defined process and a shared
> accumulated context, lets a person solve hard problems better than a conversation with one
> universal AI.**

Inside it are three separate bets.

| The bet | Against |
| --- | --- |
| **Team > Agent** | one universal assistant |
| **Process > Free chat** | free-form correspondence |
| **Persistent Space > Disposable conversation** | a throwaway thread |

### Team > Agent

Not because five agents are automatically smarter than one.

Because different, independent ways of looking at a task give you what a single sequential
context cannot: different information, a different frame, and real disagreement you can see and
take apart.

### Process > Free chat

A good team on its own still guarantees nothing.

Sometimes participants must hear each other. Sometimes they must think independently first.
Sometimes one must attack another's argument. Sometimes a decision cannot be made until the
problem has been stated.

So the way of working together is part of the environment, not an instruction inside yet another
prompt.

### Persistent Space > Disposable conversation

The most valuable part of hard work is not the transcript. It is the decisions, the assumptions,
the facts found, the constraints and the open questions.

None of that should disappear with a finished chat. Today the space holds the conversation, the
team, the rooms and the shared goal; structured memory is the next stage — more on it below.

**The conversation ends. The space remains.**

---

## Why multi-agent usually fails

The main risk of such systems is **multi-agent theatre**.

Five voices retell one thought in turn, politely agree with each other and produce a summary at
the end. It costs more than one good prompt without necessarily being smarter.

So the value comes not from the number of speakers but from the architecture of thinking:

```text
independent exploration
        ↓
different information
        ↓
real disagreement
        ↓
challenge
        ↓
synthesis
        ↓
human decision
        ↓
commit
```

The critical element is **independent exploration**.

If agents see each other's answers straight away, the first answer becomes an anchor, and several
intelligences quickly turn into several ways of agreeing with the first one.

That is why the first question in a room is answered in a round: everyone gets the feed up to
the same mark and answers without seeing their neighbours. Positions first, collision after.

---

## What it looks like

A premortem in an empty room: give it a subject, and the team walks the steps instead of answering
at random.

```text
Roman
In a week we roll the mega-menu out to all traffic.

premortem(megamenu) · 1/3 · The funeral · blind
Scholar, Sceptic and Engineer answer without seeing each other

Sceptic
Six months on. The menu shipped, sign-up conversion fell 4%.
The cause: on mobile the second level opens on the same tap…

Engineer
We failed differently: the category tree is assembled on the client,
on slow phones the first screen waits 900 ms…

premortem(megamenu) · 2/3 · The autopsy
Roman
The second one matters more. What does it cost to check?
```

A blind step is not decoration: everyone gets the feed up to the same mark, so the first answer
does not frame the rest. A message from the human stops the queue at any point: they answer that,
not what came before.

## What this rests on

The rooms are not a matter of taste. Here is what they lean on, with numbers and links.
The full breakdown with evidence labels, including work that does **not** support the popular
claims, is in [`docs/dynamics.md`](docs/dynamics.md) (in Russian).

**Apart first, together after.** A meta-analysis of 65 studies and 3189 groups: in discussion,
commonly held information comes up about 2 SD more often than unique information, and groups
where one member held the key were 8 times less likely to solve the task ([Lu, Yuan, McLeod
2012](https://journals.sagepub.com/doi/abs/10.1177/1088868311417243)). Hence steps with
`hear: no`.

**Disagreement beats being right.** Groups with diverging starting positions solved the task
significantly more often — even when none of the positions was correct ([Schulz-Hardt et al.
2006](https://www.semanticscholar.org/paper/679ba16b7a51e1c0bbd53e900c22820b4aadcbfe),
135 groups). Hence the "Position" step before any analysis.

**An assigned sceptic works worse than a real one.** A devil's advocate by appointment makes
everyone else dig into their original view ([Nemeth, Brown, Rogers
2001](https://onlinelibrary.wiley.com/doi/abs/10.1002/ejsp.58)). So disagreement comes from
setup — a different engine, its own context — not from a "push back" line in the prompt.

**Three is no worse than six.** Groups of 3, 4 and 5 beat the best of as many individuals,
but 4 and 5 are no better than 3 ([Laughlin et al.
2006](https://pubmed.ncbi.nlm.nih.gov/16649860/)). Size only helps where a correct answer is
recognisable once seen ([Amir et al.
2018](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0192213)). Hence
3–4 participants per room rather than "everyone".

**Agent debate does not pay for itself.** Across 5 methods, 9 benchmarks and 4 models, debate
often loses to plain chain-of-thought at many times the cost; what helps is **model
heterogeneity** ([Zhang et al. 2025](https://arxiv.org/abs/2502.08788)). Agents are also
conformist ([Zhang et al., ACL 2024](https://aclanthology.org/2024.acl-long.782/)), and a wrong
peer misleads a correct model more easily than a correct one repairs a wrong model ([Qu, Fu, Hu
2026](https://arxiv.org/abs/2606.01637)). Hence two engines, not one.

**The human is the strongest anchor in the room.** Sycophancy is baked into RLHF preferences
([Sharma et al. 2023](https://arxiv.org/abs/2310.13548)), so the participant prompt carries an
explicit ban on echoing the human's wording.

What the literature does not have: evidence that Six Hats works as a whole method, or that a
premortem "finds 30% more risks" — its confirmed effect is knocking down confidence in the plan
([Veinott, Klein, Wiggins
2010](https://idl.iscram.org/files/veinott/2010/1049_Veinott_etal2010.pdf)).

## `room(subject)`

The name of the product is its interface. **Open space** — a shared room where people talk;
**`open(space)`** — a function call: open a space.

The sign in the header shows where you are: on the left, which room you are in; in the brackets,
what the talk is about.

```text
open(space)               nothing started yet
open(product_strategy)    the common room, and the subject is named
red(megamenu)             stress-testing what is finished
green(launch)             looking for a move nobody expects
```

## Which room to go to

| Situation | Room |
| --- | --- |
| The obvious answer won't do; you need moves nobody expects | 🟢 Green |
| Something finished needs roasting: where it tears, what was missed | 🔴 Red |
| Code, design, build the thing itself | 🔵 Blue |
| Understand something, think it through, learn — no decision at the end | 🟣 Violet |
| You need specific people for one specific task | ⚪ White |
| Just a conversation | Openspace |

Each room has its own cast, its own way of working and its own readiness to speak up.
You pick a room from the cards on the empty screen or the list in the bar under the composer;
each has its own feed and its own memory, so moving there is moving, not switching a mode.

## The human decides

`open(space)` does not try to replace the person with a collective of agents. Agents explore,
argue, criticise and synthesise. **The decision stays with the human.**

The next step for the product is to turn that into an explicit operation, close to git. When
something has genuinely become part of the understanding of the task, the environment proposes
a change to the shared context:

```diff
+ decision: keep Select inside the core product
+ assumption: premium demand is sufficiently distinct
+ open_question: pricing elasticity
```

The person decides what to keep.

```text
commit
```

**This does not exist yet.** `/remember`, the diff and `commit` are stage `0.4`, the one
everything else is being built for. Today the conversation itself is kept, and the model of the
task lives in the shared goal and in what the participants remember.

---

## Local first

`open(space)` itself runs on your machine: the server, the feed, the role and room files. The
models do not. It launches your installed and authorised `claude` and `codex` through their usual
CLIs: no separate API keys and no separate per-token billing for `open(space)`, and requests go
where they normally go from those CLIs.

```bash
npm run dev
```

This runs the server and watches `web/`: a change to the client rebuilds itself. Not touching the
client — `node server.js` is enough. Open `http://localhost:4477`.

```bash
node server.js --port 4477 --workdir ../my-project --user roman
```

The working directory is where participants read and **edit** files, without confirmations. By
default it is this repository. Point it at a project where you are ready to see someone else's
changes in `git diff`.

The first run needs the client dependencies; the build in `public/` is not committed:

```bash
cd web && npm install
```

---

## How the conversation runs

Participants do not spin in an autonomous loop — they are woken by being addressed, and each one
receives only what appeared since its own last turn.

- `@name` addresses a message to a specific participant.
- With no tag, the participants on duty answer — defined by the current mode.
- `[skip]` is a legal move: nothing to add, the feed is left alone.
- In free conversation, after N turns in a row without the human, everything pauses.
- `Esc` pauses; an answer already in flight is not thrown away.

Engines, skills, context economy and the API —
[`docs/architecture.md`](docs/architecture.md).

---

## If something doesn't work

| What you see | What to do |
| --- | --- |
| A participant answers with an error about `claude` or `codex` | The engine is missing or not logged in: check `claude -p ok` and `codex exec -` in a terminal |
| Everyone is silent, the feed is frozen | The conversation is paused — write anything and it resumes |
| A change to the interface doesn't show up | You need `npm run dev`: under `node server.js` the client is not rebuilt |
| The port is taken | `node server.js --port 4480` |
| `SPACE_DEBUG=1` | Prints the flags each CLI is actually started with |

## The product model

```text
Space     = where          Agent   = who
Skill     = can do what    Context = knows what
Mode      = how we work    Rule    = must not
Memory    = learned what
```

| Entity | Today |
| --- | --- |
| **Space** | one machine, rooms via `?room=`; still called `room` in the code |
| **Agent** | nickname, role, archetype, pole, domain, skills, model, avatar |
| **Mode** | eleven modes and an editor — one field, as text |
| **Rule** | the laws of the space reach every prompt; the order of rules is declared |
| **Context** | partly: the working folder and the space's memory |
| **Memory** | works: six kinds of records, the archivist proposes, the human confirms |
| **Skill** | three per participant: files, commands, the web |

The concept and roadmap — [`docs/concept.md`](docs/concept.md).

## Status

```text
0.1 Room       ██████████  done
0.2 People     ██████████  done
0.3 Modes      █████████░  almost
0.4 Memory     ███████░░░  in progress
0.5 Spaces     ██░░░░░░░░  next
0.6 Physics    ██████░░░░  in progress
0.7 Skills     ██████░░░░  in progress
```

**Memory already works:** the archivist folds the conversation into decisions, findings,
constraints, assumptions, open questions and lessons, offers them on a card, and you confirm
with a click. What's missing is provenance — who wrote it down, when, and what superseded it.

**Spaces are next:** rooms live on one machine and are still called `room` in the code.
A space as a portable thing — with its own team, laws and memory — starts with that rename.

---

## Settings

Everything is edited in the interface, **Profile → Settings**, and applies without a restart:
participants (who is here), modes (how you work) and the space (why you are here and what is
remembered). The mode editor writes the same `modes/*.md` files. On disk the same state is described by `openspace.config.json` — it is created on first run
and stays out of the repository: these are your machine's settings.

## Repository map

| Path | What's inside |
| --- | --- |
| `AGENTS.md` | the canon: design system, tokens, DRY, the language of the interface |
| `docs/handoff.md` | where the project stands and what's next — read this first |
| `docs/todo.md` | review of the code and the process: defects, structure, loose ends |
| `docs/plan.md` | the order of work following that review |
| `docs/dynamics.md` | what research says about group decisions |
| `docs/concept.md` | the product concept and roadmap |
| `docs/architecture.md` | engines, access, context economy, API |
| `roles/` | agent roles |
| `archetypes/` | ready-made voices: one file per archetype |
| `modes/` | ways of working |

---

**Open a space. Bring who you need. Pick your format. Create.**
