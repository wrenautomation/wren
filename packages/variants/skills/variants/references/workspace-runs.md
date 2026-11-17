# Workspace runs

A video, image or page batch builds in the subject's workspace: a project folder on William's Mac. Its `VIREO.md` is the recipe: how to brief, build and ship in that project. You start the runs. Each run is headless: no person answers, and a call no rule allows is denied. Only he can start them. In Claude Code the same commands are `./bin/wren agent run vireo --subject <subject>` and `./bin/wren agent runs|stop`.

```sh
vireo run <subject> "<prompt>" [--model m]   # queues one run in the subject's workspace, prints its id
vireo runs [run] [--wait 540]                # state, result, denied calls, session
vireo stop <run>
```

Every workspace takes three prompts. Its recipe holds the how.

1. **Agree first.** Read his calls and get his guide for the next batch. If `vireo run` says no workspace builds the subject, tell him it needs a Claude Code session, or a workspace (`wren agent workspace set`).
2. **Brief.** `vireo run <subject> "brief batch <N>, <count> samples. His guide, word for word: …"`. Include live steers word for word. The run writes the brief; its result lists each sample's name and its one idea. Show him the list.
3. **Samples.** One run per sample: `vireo run <subject> "sample <name>, batch <N>, slot <k>"`, k = 1, 2, 3… in order. Runs queue; two build at a time. Then `vireo runs --wait 540` until none is queued or running.
4. **Ship.** `vireo run <subject> "ship batch <N>: <names>"`. The run deploys the preview and registers the batch (`variants add`). Tell him the batch waits on the Variants page.
5. A failed run: read `result` and `denied`, then start it again once. A second fail: tell him what it needs. A run's session lives in the workspace folder: he opens it from a terminal there (`claude --resume <session>`), not from this chat.
