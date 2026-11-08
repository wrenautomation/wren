# Makers

A maker is a setup on William's Mac that builds in the subject's project: pages, video, anything a chat cannot make. You start its runs. Each run is headless: no person answers, and a call no rule allows is denied. In a chat `maker` is on PATH. In Claude Code the same commands are `./bin/wren agent makers|run|runs|stop`.

```sh
maker list                                    # makers, and the subjects each serves
maker start <maker> "<prompt>" [--model m]    # queues one run, prints its id
maker status [run] [--wait 540]               # state, result, denied calls, session
maker stop <run>
```

Every maker takes three prompts. Its own instructions hold the how.

1. **Agree first.** Read his calls and get his guide for the next batch. Pick the maker whose `serves` has the subject. None: tell him it needs a Claude Code session.
2. **Brief.** `maker start <maker> "brief batch <N>, <count> samples. His guide, word for word: …"`. Include live steers word for word. The maker writes the brief; its result lists each sample's name and its one idea. Show him the list.
3. **Samples.** One run per sample: `maker start <maker> "sample <name>, batch <N>, slot <k>"`, k = 1, 2, 3… in order. Runs queue; two build at a time. Then `maker status --wait 540` until none is queued or running.
4. **Ship.** `maker start <maker> "ship batch <N>: <names>"`. The maker deploys the preview and registers the batch (`variants add`). Tell him the batch waits on the Variants page.
5. A failed run: read `result` and `denied`, then start it again once. A second fail: tell him what it needs. He can open a run's session in the maker's chat.
