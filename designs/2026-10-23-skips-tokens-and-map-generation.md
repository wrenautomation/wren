# Skips, tokens and map generation

Living doc. Started 2026-10-23. Three questions from William: can the runtime hold a real NFA, how does the map show a skip, and how does a map get made and placed by itself. The NFA is the backend. The map is the view. The map never draws the automaton.

## Target (cost zero)

- The runtime: a journey holds a set of tokens, one per branch the person is on. A skip is any forward move. Every move is an event with the nodes it passed.
- The map: the designer draws the main path only. The map adds skips from real trails. A rare skip is a small count; a common skip is an arc.
- Generation: a sketch or a sentence becomes a draft shape. The layout places it with no hand work. A person applies it.

## Today

| Part | State |
|---|---|
| One current node per journey | built. One open journey per person (`uq_journeys_open`). |
| Skips | built, implicit. A cause can target any node down a flow path. `pathOf` crosses each edge; the nodes between are `skipped` on the `moved` event and fire `trigger.journey` `skipped`. No edge has to exist for the skip. |
| Back moves | built as `loop` edges: close the journey, open a new one. |
| Logic stations (condition, race, split, join, ab, approval, link), exits, frames | drawn only. `lowerable` refuses them: "The runtime does not run it yet." |
| Two branches at once | not built. A person sits on one node. |

So the runtime is a DFA plus free forward jumps. That is an NFA with epsilon moves, already reduced: one state at a time. It is enough for skips. It is not enough for parallel work.

## Is a real NFA needed?

A true NFA (a set of current states) matters only when one person is in two places at once. Cases:

- A client in delivery who also gets upsell offers. Real, but today it is "the same journey going deeper": upsell sits after deliver. It needs tokens only if upsell runs during delivery.
- A lead who booked a call but still gets nurture mail. Not a state: the nurture is a cadence that stops or not. No token.
- Split and join stations on the map (onboard: contract + payment + kickoff, all three). Real. This is the first true case.

The right name for split and join is a token net (a Petri net, as BPMN runs), not an NFA. An NFA picks one path. A token net runs all of them.

Recommendation: do not build tokens now. Build them with the first split station a client needs. Skips need no runtime work.

### Tokens, when built

- `journey_tokens`: `journey`, `node`, `status`, `trail`. The journey row keeps `node` as the furthest token, so readers that read one node keep working.
- A split makes one token per out track. A join waits for its `rule` (all, any, 2 of 3), then makes one token.
- The arrival key becomes `journey:<id>/<token>`. `uq_events_entry` keeps once per node per token.
- Framework check first: XState was vetted and refused in `2026-10-18-journeys.md`. Restate plus the spine already run the steps. Tokens are rows, not a new engine.

## Skips on the map

The runtime allows every forward skip. So the map does not ask the designer to draw them. It shows the skips people made.

- Data: each `moved` event with a non-empty `skipped` is one skip from `from` to `to`. A new view `pipeline.skip_flow`: per version, `from`, `to`, window: count and share of the people who left `from`.
- Draw rule:
  - Share 5% or more and 3 people or more: an **express arc**. A thin arc over the stations it passes, in the line colour, with the count. This is the arc in William's sketch.
  - Less: a **count on the landing station**: "+2 skipped in". Hover lists from where.
  - A station that 30% or more pass by gets a **dashed ring**: an optional step.
- A designer can still draw an arc on purpose, as a planned express (dotted, like a planned track). It lowers to nothing: the runtime already allows the move.
- Engine: a new `ViewTrack` kind `express` `{ from, to, count }`. Layout keeps room above the line for arcs. The lab score counts an arc that cuts a name as an overlap.

Thresholds are open decision 2.

## Map placement

`2026-10-23-metro-layout-lab.md` holds this. Placers today: `current`, `elk-bk`, `elk-ns`. Still to do: `dagre`, `dot` (bead wa-g4p). Then pick one path by score and by eye. Add the express arcs to the cases before the pick.

## Map generation

The parts exist. The path is:

1. Input: a sentence, a CRM export, or a canvas sketch.
2. An agent writes a metro draft with the draft ops (`editDraft`, `wren shape` draft commands).
3. `checkMetro` and `lowerable` say what is wrong in plain words.
4. The layout places it. Zoom folds groups.
5. A person applies the draft. The version is the record.

What is missing:

- Default groups. A run of stations on one line in one column folds into one capsule when the draft names no group. Today a group must be named. This makes a vague map (William's "keep it vague") the default zoom.
- Sketch to draft. Today an agent reads the canvas by hand, as on 10-23. A `wren shape from-sketch <png>` only wraps that. Not worth code yet.

## Algorithms on the trails

The trails are an event log: one case per journey, one event per crossing. Known methods then apply. The data draws the shape, or the data checks it.

1. **Process mining** (van der Aalst). The most useful one.
   - Discovery (Inductive Miner, Heuristic Miner): build the real shape from what people did. The Inductive Miner always gives a sound shape. Point it at a client's CRM export to get a draft of their map.
   - Conformance (token replay, alignments): compare the real trails to the drawn shape. It shows each skip, extra step and dead step. The skip arcs above are a simple form of this.
   - Framework: PM4Py (open source, Python; license AGPL, to confirm). Wren is TypeScript, so it runs at the edge as a job, not in core. Or we port the one method we need.
2. **Absorbing Markov chains.**
   - Each edge's chance comes from the trails. Money and dropped are end states.
   - The fundamental matrix N = (I − Q)⁻¹ gives each station its chance of reaching money and the expected steps to get there. Weight steps by dwell time to get days.
   - One formula gives lead scores, a value per node, and the step where a fix pays most.
3. **Workflow-net soundness** (van der Aalst).
   - When tokens come, this check runs before a draft is applied. It proves no person can deadlock at a join, and every token can reach an end.
   - It is the check for split and join stations.
4. **Minimization (Hopcroft) and bisimulation.**
   - Two stations that act the same can merge. Same means the same moves out, to the same places.
   - This can drive the default groups: the map folds stations that act as one. The vague map then follows the data, not taste.

Less useful here:

- Subset construction (NFA to DFA): the runtime already holds one state.
- Automata learning (L*, RPNI): process mining does the same job better on noisy logs.
- Sequence mining (PrefixSpan): useful only to list the top paths.

Order:

1. Conformance on trails. It feeds the skip arcs.
2. Markov values for each node.
3. Discovery for client onboarding.
4. Soundness, only when tokens are built.

## Open decisions

1. Tokens: wait for the first split a client needs (recommended), or build now.
2. Skip thresholds: arc at 5% and 3 people, dashed ring at 30%.
3. Planned express arcs: allow (recommended, they lower to nothing) or leave them out.

## Decision log

- 2026-10-23: the NFA stays in the backend; the map stays a metro map. William.
- 2026-10-23: skips need no runtime change; the map draws them from trails.
- 2026-10-23: trail algorithms added (process mining, absorbing Markov chains, soundness, minimization), in that build order. William.
