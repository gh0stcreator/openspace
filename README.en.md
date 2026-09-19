[Русский](README.md) · **English**

# `open(space)`

**A shared thinking environment for humans and AI agents.**

<img src="docs/img/cover.jpg" alt="open(space)" width="100%">

Not a chat with several models. A space for one task: you invite the minds it needs, you decide
how exactly they should work together, and the conversation leaves behind more than a transcript.

```text
open(product_strategy)
research(market)
redteam(pricing)
brainstorm(naming)
premortem(launch)
```

They explore independently, disagree, test each other's arguments and assemble a decision.
The human decides.

---

## Manifesto

Most AI products today are built around a conversation with one general intelligence.

Open a chat. Ask a question. Get an answer. Clarify. Close the tab.

For many tasks that is enough. For hard work it is not.

Strategy, product, research, writing and reviewing decisions rarely need one right answer. They
need different ways of thinking: to explore, to invent, to doubt, to attack an argument, to find
a contradiction, to compare options and to decide.

The product's main hypothesis:

> **A team of specialised intelligences, working in an explicitly defined process and a shared
> accumulated model of the task, lets a person solve hard problems better than a conversation
> with one universal AI.**

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
team, the modes and the shared goal; structured memory is the next stage — more on it below.

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

That is why a step of a mode can run with `hear: no`: everyone on that step gets the feed up to
the same mark and answers without seeing their neighbours. Positions first, collision after.

---

## `mode(topic)`

The name of the product is also its interface.

```text
open(space)
```

**Open space** — a shared room where people talk.
**Outer space** — emptiness and a sense of room to move.
**`open(space)`** — a function call: open a space.

The logotype shows the current state:

```text
open(space)               an empty space, a conversation with no procedure
open(product_strategy)    the same freedom, with the topic named
sixhats(megamenu)         taking the question apart in rounds
premortem(launch)         looking for how this fails
```

On the left — **how we are thinking right now**. In the brackets — **what about**. At idle that
is the real state of the space; on hover both halves change in turn, showing the grammar of the
product, and the sign returns to the actual state.

---

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

`open(space)` itself runs on your machine: the server, the feed, the role and mode files. The
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

Engines, access levels, context economy and the API —
[`docs/architecture.md`](docs/architecture.md).

---

## The product model

```text
Space     = where          Agent   = who
Skill     = can do what    Context = knows what
Mode      = how we work    Rule    = must not
Memory    = learned what
```

| Entity | Today |
| --- | --- |
| **Space** | one machine, rooms via `?room=` |
| **Agent** | nickname, role, character, engine, model, access, avatar |
| **Mode** | a set of modes and an editor for them |
| **Rule** | partly: conversation rules and what a mode requires |
| **Context** | partly: the shared goal of the conversation |
| **Memory** | written, not wired yet (`lib/memory.js`) |
| **Skill** | not yet |

The concept and roadmap — [`docs/concept.md`](docs/concept.md).

## Status

```text
0.1 Room       ██████████  done
0.2 People     ████████░░  almost
0.3 Modes      ██████░░░░  in progress
0.4 Memory     ██░░░░░░░░  next
0.5 Spaces     ░░░░░░░░░░
0.6 Physics    ░░░░░░░░░░
0.7 Skills     ░░░░░░░░░░
```

**The product becomes itself at 0.4:** you leave the room, come back later — and it remembers
what you worked out there.

---

## Settings

Everything is edited in the interface, **Profile → Settings**, and applies without a restart:
participants (who is here), modes (how you work) and the space (why you are here and what is
remembered). The mode editor writes the same `modes/*.md` files. On disk the same state is
described by `openspace.config.json`.

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
| `modes/` | ways of working |

---

**Open a space. Bring the right minds. Give them a way to think together. Keep what they learn.**
