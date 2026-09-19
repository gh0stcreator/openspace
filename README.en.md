<img src="docs/img/cover.png" alt="open(space)" width="100%">

[Русский](README.md) · **English**

# `open(space)`

**A shared thinking environment for humans and AI agents.**

An environment where a person assembles a team of AI agents, gives it a way of working, and
accumulates a shared model of the task.

Not a chat with several models. **A space for thinking together.**

```text
open(product_strategy)
open(book)
open(launch)
open(brand)
open(career)
```

You open a space for a task. You invite the minds it needs. You decide how exactly they should
work together. They explore independently, disagree, test each other's arguments and assemble
a decision.

And what you worked out together **stays in the space**.

---

## Manifesto

Most AI products today are built around a conversation with one general intelligence.

Open a chat. Ask a question. Get an answer. Clarify. Close the tab.

For many tasks that is enough. For hard work it is not.

Strategy, product, research, writing and reviewing decisions rarely need one right answer.
They need different ways of thinking: to explore, to invent, to doubt, to attack an argument,
to find a contradiction, to compare options and to decide.

`open(space)` is built on three bets:

| The bet | Against |
| --- | --- |
| **Team > Agent** | one universal assistant |
| **Process > Free chat** | free-form correspondence |
| **Persistent Space > Disposable conversation** | a throwaway thread |

### Team > Agent

Don't ask one general intelligence to be researcher, engineer, critic and designer at the
same time.

Assemble several specialised minds with different roles, context and ways of looking at the task.

### Process > Free chat

A good team on its own still guarantees nothing.

Sometimes participants must hear each other. Sometimes they must think independently first.
Sometimes one must attack another's argument. Sometimes a decision cannot be made until the
problem has been stated.

So the way of working together is part of the environment, not an instruction inside yet
another prompt.

### Persistent Space > Disposable conversation

The most valuable part of hard work is not the transcript.

It is the decisions, the assumptions, the facts found, the constraints, the open questions and
what the team has already understood about the task.

None of that should disappear with a finished chat.

**The conversation ends. The space remains.**

---

## The idea

The main hypothesis of `open(space)`:

> **A team of specialised intelligences, working in an explicitly defined process and a shared
> accumulated model of the task, lets a person solve hard problems better than a conversation
> with one universal AI.**

So the central object here is not a message, not a model and not even an agent.

**The central object is the Space.**

```text
Space     = where          Agent   = who
Skill     = can do what    Context = knows what
Mode      = how we work    Rule    = must not
Memory    = learned what
```

---

## `mode(topic)`

The name of the product is also its interface.

```text
open(space)
```

**Open space** — a shared room where people talk.
**Outer space** — emptiness and a sense of room to move.
**`open(space)`** — a function call: open a space.

The logotype shows the current state of the product:

```text
open(product_strategy)
research(market)
brainstorm(positioning)
redteam(pricing)
decide(launch)
```

On the left — **how we are thinking right now**. In the brackets — **what about**.

At idle that is the real state of the space. On hover both halves change in turn, showing the
grammar of the product, after which the sign returns to the actual state.

---

## Not five bots in one chat

The main risk of multi-agent systems is **multi-agent theatre**.

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

If agents see each other's answers straight away, the first answer becomes an anchor. Several
intelligences quickly turn into several ways of agreeing with the first one.

That is why a step of a mode can run with `hear: no`: participants get the same starting point
and answer independently.

Positions first. Collision after.

---

## Human stays in the loop

`open(space)` does not try to replace the person with a collective of agents.

Agents can explore, argue, criticise and synthesise. **The decision stays with the human.**

When something has genuinely become part of the understanding of the task, the system proposes
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

---

## What it looks like

```text
open(product_strategy)

roman:
Should Select become a separate product?

/mode strategy

researcher:
I'll examine willingness to pay, segmentation and comparable products.

skeptic:
I'll try to prove that separating Select destroys the core proposition.

strategist:
I'll model both portfolio architectures.

[ independent exploration ]

...

synthesis:
Three viable options remain...

roman:
Keep option B. We still need evidence for the pricing assumption.

/remember

+ decision: keep Select inside the core product
+ assumption: premium demand is sufficiently distinct
+ open_question: pricing elasticity

commit
```

---

## Local first

Everything runs locally, on your machine and on your own subscriptions. No API keys and no
separate per-token billing: the engines are launched through the same CLIs you use yourself.

You need `claude` and `codex` installed and logged in.

```bash
npm run dev
```

This runs the server and watches `web/`: a change to the client is rebuilt on its own. If you
are not touching the client, `node server.js` is enough.

Open:

```text
http://localhost:4477
```

The port, working directory and nickname can be overridden:

```bash
node server.js --port 4477 --workdir ../my-project --user roman
```

The first run needs the client dependencies; the build in `public/` is not committed:

```bash
cd web && npm install
```

---

## How the conversation works

Participants do not spin in an autonomous loop. They are woken by being addressed.

```text
human → @skeptic
              ↓
        answer into the feed
              ↓
      the answer mentions @engineer
              ↓
        @engineer answers
```

Each agent receives only what appeared since its own last turn, not the whole thread again.

The rules, briefly:

- `@name` addresses a message to a specific participant.
- With no tag, the participants on duty answer — defined by the current mode.
- `[skip]` is a legal move: with nothing to add, the feed is left alone.
- After N turns in a row without the human, the conversation pauses itself.
- `Esc` pauses the conversation; an answer already in flight is not thrown away.

Details about engines, access levels, context economy and the API are in
[`docs/architecture.md`](docs/architecture.md).

---

## The product model

| Entity | Today |
| --- | --- |
| **Space** | one machine, rooms via `?room=` |
| **Agent** | nickname, role, character, engine, model, access, avatar |
| **Mode** | a set of modes plus an editor |
| **Rule** | partly: conversation rules and what a mode requires |
| **Context** | partly: the shared goal of the conversation |
| **Memory** | written, not wired yet (`lib/memory.js`) |
| **Skill** | not yet |

The full concept and roadmap are in [`docs/concept.md`](docs/concept.md).

---

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

Everything important is edited in the interface through **Profile → Settings** and applies
without a restart.

**Participants** — who is here: nickname, role, task, character, engine, model, access.
**Modes** — how you work: steps, participants, `hear`, closing conditions. The editor writes the
same `modes/*.md` files.
**Space** — why you are here, what participants remember, and the feed.

On disk the same state is described by `openspace.config.json`.

---

## Repository map

| Path | What's inside |
| --- | --- |
| `AGENTS.md` | the canon: design system, tokens, DRY, the language of the interface |
| `docs/handoff.md` | where the project stands and what to do next — read this first |
| `docs/todo.md` | review of the code and the process: defects, structure, loose ends |
| `docs/concept.md` | the product concept and roadmap |
| `docs/architecture.md` | engines, access, context economy, API |
| `roles/` | agent roles |
| `modes/` | ways of working |

---

**Open a space. Bring the right minds. Give them a way to think together. Keep what they learn.**
