# autobrowse film, take 2 (2026-11-13)

Status: draft script and shots. Replaces the 10-24 cut (`2026-10-24-autobrowse-x-demo.md`), which William judged weak: captions on a muted screen recording, no person, no story, no stakes.

Model: the Roma 2.0 launch film (Canon `web-lnkd-in-p-gd74ttsq`, 109 s, studied at 1 fps; frames and transcript in the session scratchpad `roma/`). William: "good visuals and really good voice audio quality".

## What Roma does (the parts we take)

| Roma | Ours |
|---|---|
| 6 s pain cold open, no words: chat boxes swarm his face, white flash | Same shape, our pain: a slow agent, a token meter, "Verify it's you", a moved button |
| Founder on camera, warm lit room, clean voice, captions one phrase at a time | William on camera and voice (he is the brand now) |
| One concrete story told end to end (ramble → 3 tasks → agents → receipt) | One real chore: the daily creator read on X, Instagram and Threads |
| One motif: a glowing line runs through every scene and joins card to card | The trace: the path of recorded clicks. It draws through the page, then flows into the code. The line is the product |
| Real UI, dark, cropped close, focus pulls | Real takes from `autobrowse film`, lens moves from the film standard |
| Receipt: $48.00 → $3.20, big serif figures | First run vs every run after, from the filmed runs |
| Logo, tagline, URL | Wordmark, tagline, `npm i @wrenautomation/autobrowse` |

This changes two 10-25 rules in `canon/topics/launch-films/notes.md`: "music only, no voice" and 40-50 s. The film runs about 80 s with his voice. His call (below).

## Script (William's voice, about 80 s)

Every number is a placeholder until the filmed run gives it.

| # | s | Picture | Voice |
|---|---|---|---|
| 1 | 0-6 | Cold open. A browser agent clicks slowly; a token meter climbs; "Verify it's you"; a 2FA prompt; a button moves and a red error stacks over it. The pile closes in on his face. White flash. | none (UI sounds only) |
| 2 | 6-10 | Face, lit room. | I got tired of paying a model to click the same buttons every day. |
| 3 | 10-15 | Black, the trace draws the wordmark. | So I built autobrowse. It learns a site once, then runs it as plain code. |
| 4 | 15-23 | Face, then a wall of creator profiles (X, Instagram, Threads). | Every morning my system reads forty creators. None of them give me an API I'd pay for. |
| 5 | 23-33 | Take: the agent explores one X profile. The trace draws through each click and scroll. | The first time, an agent works out the page. Every step it takes is recorded. |
| 6 | 33-41 | The trace leaves the page and flows into a TypeScript file; lines light up as it passes. | autobrowse turns that recording into a normal Playwright script. |
| 7 | 41-50 | The script runs: many profiles, fast, rows land in a table. | After that it runs with no model at all. Same steps, every day. |
| 8 | 50-56 | Receipt. "First run" $0.0X, then "Every run after" $0.00. Big serif figures. | The first run cost [X] cents. Every run since costs nothing. |
| 9 | 56-66 | Take: a step fails on a moved button. The agent finishes it on the live page; the trace reroutes; one line of the script changes. | When a site moves a button, the agent finishes the step and rewrites that one line. |
| 10 | 66-74 | A sign-in: the code arrives in the inbox and fills itself. A phone: "Buy domain, $12? Reply yes." | It signs in with my saved logins, reads the code from my inbox, and asks me before it spends a cent. |
| 11 | 74-77 | Face. | Explore once. Run it forever. |
| 12 | 77-82 | Wordmark, tagline, install line. | none |

## Shots: real or built

- Real takes (`autobrowse film`): 5, 7, 9, 10 (inbox code). The X profile read runs as `x@wren`. The moved button in 9 is a page we change on purpose, said in the doc, never a claim about X.
- Built (Remotion, studio kit): 1, 3, 6, 8, 12, the trace line, the phone in 10.
- Face and voice: 2, 4, 11, recorded by William. Voice for every row.

## Craft (film standard plus Roma)

- 1920x1080, 60 fps. Dark plane, real UI cropped close, one lens move per shot, focus pull on the act.
- The trace: one rust line (Wren brand), glow, it travels between shots and joins them. Never a stripe on a card.
- Captions: one phrase at a time, white, bottom center, sentence case.
- Sound: his voice to -14 LUFS (Roma -14.7 measured), music bed under it, UI sounds low. Polish B on the voice (`scratchpad/polish/ab.sh`); a lav or phone mic beats the webcam.
- Masks per the launch-films notes.

## Open: William's calls

1. Voice and face (recommended), or music only as the 10-25 rule says.
2. The story: the daily creator read (recommended: it is real and running) or a sign-in chore.
3. Length about 80 s.

## Log

- 2026-11-13: draft from the Roma study. Open: the three calls above.
