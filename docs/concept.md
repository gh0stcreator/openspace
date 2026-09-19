# Концепция продукта

Продуктовый канон `open(space)`. Записано 19 сентября 2026 года.
Новая возможность должна усиливать модель Space, а не просто добавлять ещё одну ИИ-функцию, —
этот документ и есть фильтр дорожной карты.

---

## 1. Центральная метафора

`open(space)` означает три вещи одновременно:

- **Open space** — общее рабочее пространство, где можно разговаривать.
- **Outer space** — открытое пространство, пустота, ощущение бесконечности.
- **`open(space)`** — вызов функции: открыть некоторое пространство.

Поэтому название одновременно является брендом, интерфейсом и командой.

В состоянии по умолчанию:

```
open(space)
```

Когда пользователь работает:

```
open(product_strategy)
```

Это и есть динамический логотип продукта.

## 2. Базовая модель

Семь сущностей. Онтологию стоит держать зафиксированной и дальше не смешивать понятия.

```
Space      = WHERE
Agent      = WHO
Skill      = CAN DO WHAT
Context    = KNOWS WHAT
Framework  = HOW
Rule       = MUST / MUST NOT
Memory     = LEARNED WHAT
```

## 3. Space

Space — главный объект продукта. Не conversation, не project и не agent.

```
product_strategy/

  people/
    roman
    strategist
    skeptic
    researcher
    engineer

  context/
    strategy
    research
    metrics
    customer_interviews

  mode/
    strategy_session

  rules/
    evidence_required
    challenge_assumptions

  memory/
    decisions
    learnings
    assumptions
```

Space сохраняется между сессиями и постепенно становится умнее.

## 4. People / Agents

Пользователь общается не с моделями, а с участниками. Человек — такой же участник
пространства, как агенты. Модель — внутренняя характеристика агента, а не его identity.

```
[ Роман ] [ инженер ] [ скептик ] [ креатор ]
[ эстет ] [ академик ] [ продюсер ] [+]
```

Карточка участника:

```
СКЕПТИК

Ищет слабые места,
оспаривает предположения.

ROLE          Critical thinker
CHARACTER     direct · skeptical · concise
SKILLS        research · critique · evidence
MODEL         Claude Sonnet
KNOWLEDGE     product_strategy · research
INSTRUCTIONS  ...
```

Над карточкой: `create` · `edit` · `duplicate` · `invite` · `remove`.

Огромный каталог не нужен, достаточно нескольких архетипов:
`Strategist` · `Researcher` · `Critic` · `Engineer` · `Designer` · `Facilitator` · `Editor` ·
`Customer Advocate`.

## 5. Team

Agent — отдельная компетенция. Team — композиция компетенций. Команды тоже сохраняются.

```
PRODUCT TRIO        STRATEGY TEAM       EDITORIAL BOARD
product             strategist          writer
designer            researcher          editor
engineer            skeptic             fact_checker
                    facilitator         critic
```

## 6. Modes

Здесь главное отличие от обычного multi-agent chat. Обычный продукт отвечает на вопрос
«кто должен ответить?». `open(space)` отвечает ещё и на вопрос **«как эти люди должны думать
вместе?»**.

Пользовательское имя — Modes; Framework остаётся внутренним понятием.

```
mode: free          mode: six_hats
mode: brainstorm    mode: product_critique
mode: strategy      mode: premortem
mode: red_team      mode: decision
```

## 7. Mode — это не промпт

Режим запускает процесс:

```
01 FRAME       Какое решение должно быть принято по итогам сессии?
02 EXPLORE     Агенты независимо исследуют проблему.
03 CHALLENGE   Участники атакуют аргументы друг друга.
04 OPTIONS     Формируются альтернативные направления.
05 DECIDE      Варианты сравниваются по критериям.
06 SYNTHESIZE  Решение · Допущения · Риски · Открытые вопросы
```

Ключевая механика — **independent thinking**. Если агенты сразу читают ответы друг друга,
первый ответ создаёт якорь, и пять интеллектов быстро превращаются в пять способов
согласиться с первым.

## 8. Framework понимает состав команды

```
/mode premortem

missing role:
+ skeptic

add recommended agent?
```

Режим определяет не только последовательность промптов, но и архитектуру коллективной работы.

## 9. Управление процессом

Всё происходит внутри чата, отдельный workflow-интерфейс не нужен. Сверху появляется:

```
STRATEGY SESSION

02 / 06
EXPLORE

━━━━━━━○────────
```

Доступно: `pause` · `continue` · `skip` · `rerun` · `ask` · `stop` — и вмешательство человека
между этапами.

## 10. Context

Space знает не всё подряд, а структурированную модель задачи.

```
GOAL             Launch B2B product
KNOWN            Enterprise customers currently use...
DECISIONS        → Enterprise first  → Annual contracts
ASSUMPTIONS      ? HR owns budget    ? €50/user acceptable
CONSTRAINTS      ! GDPR              ! 3 engineers
OPEN QUESTIONS   ? Pricing           ? Procurement cycle
SOURCES          12 files · 8 links
```

Это интереснее обычного «прикрепить 38 документов к чату».

## 11. Memory и commit

После разговора Space не сохраняет транскрипт — он меняет модель мира.

```
LEARNED IN THIS SESSION

+ DECISION        Test enterprise segment first
+ LEARNING        Procurement takes 3–6 months
+ ASSUMPTION      HR controls budget
+ OPEN QUESTION   Annual pricing

[ review ]
```

И здесь появляется сильный термин. Не «save to memory», а:

```
commit
```

Разговор — рабочая область. Что-то выяснили, система показывает diff контекста, пользователь
подтверждает: `commit 4 changes`. Изменения становятся частью Space.

## 12. У контекста должна быть история

Иначе shared memory быстро превращается в shared garbage. У каждого знания есть:

```
source · created_at · created_by · confidence · last_verified · status · supersedes
```

```
Pricing should be annual

decision
Roman
Sep 19

supersedes #018
```

Никакого бесконтрольного автоматического запоминания всего разговора.

## 13. Rules / Physics

Agent отвечает на вопрос «кто я?». Mode — «как мы сейчас работаем?». Rules — «какие законы
действуют здесь всегда?».

```
/rules

evidence_required
challenge_assumptions
separate_fact_from_opinion
human_approval_for_pricing
```

Три уровня:

| Уровень | Что делает |
|---|---|
| **Soft** | агенту напоминают правило |
| **Check** | система проверяет результат и показывает нарушение |
| **Hard** | процесс физически не может продолжиться |

```
RULE VIOLATION

problem_not_defined

Strategy Session cannot
enter SOLUTION stage.

[ define problem ]
```

Здесь «ценность как свойство среды» становится настоящей продуктовой механикой.

## 14. Skills

Role — «кто ты?». Skill — «что ты умеешь делать?». Смешивать нельзя.

```
maya/
  role:    product_strategist
  skills/  web_research · analyze_metrics · jtbd · market_sizing · strategy
```

Skill может содержать: `instruction` · `tool` · `knowledge` · `workflow` · `output_schema` ·
`validation`. Один skill можно дать разным агентам.

## 15. Space как распространяемый объект

Со временем сохраняется целая конфигурация: Agents + Mode + Rules + Context structure.

```
PRODUCT STRATEGY

4 people   Strategist · Researcher · Critic · Facilitator
mode       Strategy Session
rules      Evidence > opinion · Challenge assumptions · Generate alternatives
```

Другой человек открывает `open(product_strategy)`, получает копию и добавляет свой контекст.

## 16. Каталог — это каталог Spaces

Не marketplace персонажей вроде «Senior Product Manager с характером Стива Джобса»: agent
довольно быстро станет commodity. Интереснее каталог готовых способов коллективно думать.

```
Product Strategy          4 agents · 6 stages
Brutal Product Review     3 agents · adversarial
Editorial Room            4 agents · critique
Incident Room             5 agents · engineering
Board Meeting             6 agents · strategy
New Product Discovery     5 agents · JTBD
```

Почти Figma Community для интеллектуальных процессов.

## 17. Framework Builder — сильно позже

Только после того, как готовые Modes доказали ценность.

```
START → ASK HUMAN → PARALLEL(strategist, researcher, skeptic)
      → DEBATE → SYNTHESIZE → HUMAN APPROVAL → COMMIT
```

Примитивы: `Ask human` · `Ask agent` · `Ask all` · `Parallel` · `Research` · `Critique` ·
`Debate` · `Vote` · `Synthesize` · `Condition` · `Loop` · `Tool` · `Human approval` · `Commit`.
No-code programming коллективного мышления.

## 18. Язык продукта

У продукта собственная грамматика, и её стоит проектировать особенно тщательно.

| | |
|---|---|
| `open(product_strategy)` | открыть пространство |
| `@skeptic` | обратиться к участнику |
| `/invite researcher` | позвать участника |
| `/mode brainstorm` | изменить способ работы |
| `/context` | посмотреть модель мира |
| `/context add research.pdf` | добавить источник |
| `/rule evidence_required` | добавить закон |
| `/remember` | извлечь знания из разговора |
| `commit` | записать изменения в Space |
| `fork` | создать альтернативную ветку |
| `close` | закончить работу |

## 19. Это и есть айдентика

Никаких космонавтов, ракет и glowing AI spheres поверх. Кодовая эстетика становится поведением
продукта. Главный экран может буквально быть:

```
open(product_strategy)


> _
```

И огромное количество пустого чёрного пространства. Outer space возникает из пустоты, а не из
картинки космоса. Open office — из присутствующих участников. Code — из способа управления
средой. Это сильнее декоративной темы.

## 20. Динамический логотип

```
open(space)             landing
open(product_strategy)  создал проект
open(book)              переключился
open(career)            открыл карьерную штуку
```

Логотип является breadcrumb текущего состояния. Очень редкий случай, когда branding
и navigation могут буквально быть одним объектом.

## 21. Onboarding

```
open(space)


What do you want to open?

open(________________)_
```

Пользователь пишет `open(new_product)`, Enter — и открывается огромное пустое пространство:

```
open(new_product)


You're alone here.

[ + invite someone ]
```

Добавляет Strategist, потом Skeptic — и пространство начинает оживать. Сильнее стандартного
«Create your first workspace».

## 22. Визуальная система

- **Mono** — системный язык, команды, labels, identity.
- **Grotesk** — длинные ответы, чтобы не убивать читаемость.
- **Цвет агента** — знак, точка, имя, активное состояние. Не красить целые огромные сообщения
  без необходимости.
- **Black space** — полноценный элемент дизайна.
- **Панели** появляются по запросу и исчезают. Никаких трёх постоянно открытых сайдбаров.

Главный визуальный актив уже есть: огромная пустая комната с присутствующими интеллектами.
Превращать её в dashboard не нужно.

## 23. Дорожная карта

**`0.1 — Room`** ✓
Общий чат, несколько агентов, разные модели, роли, mentions, участники комнаты.

**`0.2 — People`**
Agent Card, Agent Builder, role, character, instructions, model, skills, knowledge, duplicate,
invite/remove, человек как participant.
*Результат: пользователь собирает собственную команду.*

**`0.3 — Modes`**
Три режима, но хорошо: `brainstorm`, `strategy`, `red_team`. Stages, independent answers,
orchestration, facilitator, pause, human intervention, synthesis.
*Результат: одна команда действительно работает по-разному.*

**`0.4 — Memory`**
Space Context: decisions, assumptions, learnings, constraints, open questions. `/remember`,
diff, `commit`, provenance, supersede.
*Результат: Space становится умнее после работы.*

**`0.5 — Spaces`**
`open(name)`, create, rename, duplicate, fork, share, saved team, saved mode, saved rules,
templates. Пять эталонных: `brainstorm`, `product_strategy`, `product_review`, `red_team`,
`editorial_room`.
*Результат: появляется reusable intellectual environment.*

**`0.6 — Physics`**
Rules: soft/check/hard, gates, human approval, validation, rule history.
*Результат: среда начинает определять пространство допустимых решений.*

**`0.7 — Skills`**
Reusable capabilities, tools, instructions, schemas, validation, skill sharing.

**`0.8 — Community`**
Publish Space, clone, remix, versions, creators, collections.

**`1.0 — Shared Environment`**
Notion, GitHub, Linear, Slack, Drive, Figma, permissions, shared organizational context, teams.

## 24. Чего сознательно не делать сейчас

Marketplace агентов · 50 персонажей · платежи авторам · visual workflow builder ·
100 frameworks · сложные permissions · autonomous background agents · fine-tuning ·
мобильное приложение · «AI social network» · тяжёлый enterprise RAG.

Каждая вещь выглядит логичным развитием. Ни одна пока не проверяет главную идею.

## 25. Что измерять

DAU главной метрикой быть не должен. Самая интересная — **Repeat Space Rate**: доля Spaces,
в которые пользователь возвращается для новой задачи. Обычный ИИ-разговор одноразовый;
ставка здесь в том, что «я возвращаюсь сюда, потому что здесь уже есть моя команда, процесс
и накопленное понимание».

Дополнительно: `Space created → second session` · `Free → Mode started` ·
`Mode started → completed` · `Session → commit` · `Committed memory reused` ·
`Agent reused across Spaces` · `Space duplicated/shared`.

## 26. Ближайший вертикальный slice

Не распыляться. Сделать один путь от начала до конца:

```
open(product_strategy)
        ↓
invite(strategist) · invite(skeptic) · invite(researcher)
        ↓
/mode strategy
        ↓
FRAME → EXPLORE → CHALLENGE → SYNTHESIZE
        ↓
/remember → review diff → commit → close
```

Через неделю пользователь открывает `open(product_strategy)`, и Strategist уже знает: решили
идти сначала в Enterprise, pricing пока предположение, procurement cycle остаётся открытым
вопросом.

**Вот этот момент и есть демо продукта.** Не Agent Builder, не семь моделей одновременно,
не marketplace и даже не красивый brainstorm. А: «я вернулся в комнату, а она помнит, что
здесь происходило».

---

## Короткая формула

| | |
|---|---|
| Brand | `open(space)` |
| Product | Programmable space for collective intelligence |
| Object | Space |
| Participants | Humans + Agents |
| Process | Modes |
| Capabilities | Skills |
| Knowledge | Context |
| Laws | Rules |
| Learning | Memory |
| Persistence | Commit |
| Distribution | Share / Fork |
| Language | `open()` · `@` · `/` · `commit` · `fork` · `close` |

> `open(space)` — собери нужные умы, задай им способ думать и сохрани то, до чего они
> додумались.
