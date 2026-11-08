# Grow the tree

Each sample's `parents` place it in his generation tree. Pick them on purpose. His steers come before your own picks.

## Moves

- **Mutate**: one parent, one change. Use for a leader with a clear next thing to try.
- **Cross**: two or more parents, each `took` a named part. Use when two samples each have a part he liked.
- **Wild**: no parent. One per batch at width normal, so the loop does not narrow too early.
- **Leave a line**: a branch whose samples score Bad twice in a row: stop growing it unless he says otherwise. Do not prune it; that is his steer.

## His steers

`show` gives `steers` (live ones) and `pruned` (every sample a prune covers). `add` refuses a batch that breaks one and names the steer: fix the batch, never lift the steer.

| Steer | The next batch must |
|---|---|
| `pin <s>` | have at least one sample that names `s` as a parent, every batch until lifted |
| `prune <s>` | not name `s`, or anything that grew from it, as a parent |
| `cross <a> <b>` | have one sample with both as parents; that batch ends the steer |
| `width narrow` | move a small step: one change per sample, every sample has a parent, no wild |
| `width normal` | mix: mostly mutations of leaders, one cross when it fits, one wild |
| `width wide` | spread: at least half the samples wild or far from their parents |

Code checks pin, prune and cross. Width is your judgement: say in `why` how the batch meets it.

## When he steers in chat

He says "grow from Nightfall", "kill the Atlas line", "cross 12 and 19", "go wider". Set the steer with his words in `--why`, then make the batch:

```sh
./bin/wren variants steer pin 12 --why "grow from Nightfall"
./bin/wren variants steer prune 19 --why "kill the Atlas line"
./bin/wren variants steer cross 12 19
./bin/wren variants steer width hero-background wide --why "go wider"
./bin/wren variants steer lift <steer>
```

A steer the tree page set shows in `show` the same way.
