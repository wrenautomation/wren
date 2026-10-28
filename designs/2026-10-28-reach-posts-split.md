# reach-posts split (WA-922)

Kestrel pilot. `packages/outreach/src/reach-posts.ts` (2,300 lines) had six jobs. It is now a folder, one file per job. A pure move: no body changed.

## Files

| File | Job | Holds |
|---|---|---|
| `reach-posts/settings.ts` | settings | `COMMENTS_COMPONENTS`, `COMMENT_MAX`, `COMMENT_LENGTH`, `PLATFORM_NAME`, the schema, `commentsSettings`, `allCommentsSettings` |
| `reach-posts/read.ts` | post reads | `postReader` per platform, `FeedPost`, `KeyPerson`, `PostReader`, `SEARCH_MAX`, `phrase`, `shortcodeAt`, `vanityOf` |
| `reach-posts/rank.ts` | ranking | `momentum`, `MOMENTUM_MAX`, `jobPost`, `isJobAd`, `authorFit`, `rankPost`, `topicCore` |
| `reach-posts/draft.ts` | drafting | `guardedComment`, `draftPost`, `redraftPosts` |
| `reach-posts/topics.ts` | topic plans | `topicYields`, `planTopics`, `proposeTopics` |
| `reach-posts/acts.ts` | comments, likes, follows | `planPostComment`, `postActs`, `followAct`, `autoActs`, `markPostActed`, `skipPost`, `listPosts` |
| `reach-posts/pass.ts` | the pass that runs them | `postsPass`, `keepPosts`, `postsToDraft`, `keyPeople` |

No barrel. `src/index.ts` exports each file. Importers name the file they use, so the imports layer shows the real edges.

## New public names

Five names are new to the package API:

- `NAME` → `PLATFORM_NAME`, `LENGTH` → `COMMENT_LENGTH` (clear outside one file).
- `MOMENTUM_MAX`, `KeyPerson`, `PostReader`: now exported, as more than one file reads them.

## Importers touched

- src: `pain`, `passes`, `intercept` (+ test), `components`, `scheduled`, `settle-send`.
- src/restate: `paste`, `desk-schedule`, `desk-people`, `watch`, `desk-posts`.
- test/integration: `scheduled`, `reach-posts`, `post-objects`, `touches`, `maybe-sent`, `passes`.
- The unit test moved to `reach-posts/reach-posts.test.ts`.

## Expected kestrel drift

Exports move file; import edges move. Zero exports removed. Zero routes changed. Adds: the 5 names above. William approves with `kestrel -C ../wren approve`.

## Note on the flow

For a pure move the skeleton (files, names, edges) and the bodies land in one step. A split that changes bodies gets the skeleton approved first.
