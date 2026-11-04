# Meta push flows (2026-11-04, WA-1047)

William, 11-04, after a look at ManyChat: build its three better mechanisms now, loosely tested, so we switch over the day Meta gives Advanced Access. Builds on `2026-10-11-comment-keywords.md`, `2026-10-11-dm-door.md` and `2026-10-12-push-everywhere.md`.

## Target

A comment on our Instagram or Facebook post reaches us by webhook in seconds. We keep it from the push itself, with no Graph read. A keyword in it sends the private reply at once, with a button. The tap opens Meta's 24-hour window and sends the keyword's follow-up (the link). One queue per account keeps the sends under Meta's cap. The slow poll stays only as the net for a lost push.

## Switch

`WREN_META_PUSH_EVENTS` (unset = off = today). Off: a comment push only wakes `SocialWatch`, as before. On: the push carries the comment (part 1). Parts 2 and 3 need no switch: a keyword with no button sends what it sends today, and the pace only spaces sends.

After Meta's Advanced Access (`instagram_manage_comments`, `instagram_business_manage_messages`):
1. Subscribe the webhooks: `wren social push meta` (Instagram `comments`, `messages`, `messaging_postbacks`; Page `feed`, `messages`, `messaging_postbacks`). `--check` shows them first.
2. Set `WREN_META_PUSH_EVENTS=1` in SSM `env-2`, then deploy.
3. Nothing else changes. The paused loops stay paused (WA-1043).

Our own Facebook Page's `feed` webhook needs no review, so part 1 can run on Facebook first.

## 1. The push carries the comment

`social-push.ts` said: "a push wakes a pass, it never carries a comment", so a lost, repeated or reordered push changes nothing. This reverses it.

| Option | Reads per comment | Delay | Lost push | Repeat or reorder |
|---|---|---|---|---|
| A. Push wakes, pass reads the post (today) | 1 post read (all its comments) | pass start, seconds to minutes | poll net | safe: the read is the truth |
| B. Push names the comment, read that one comment | 1 small read | seconds | poll net | safe |
| C. Push carries the comment, kept as is (chosen) | 0 | about 1 s | poll net | safe: keep dedupes on the comment's ref, a hit is unique per comment |

Priorities, in order: (1) no reads to sync the portal (William, 11-03), (2) delay, since the reply rate falls with each minute, (3) the same truth as the read. C wins on 1 and 2. On 3: Meta's comment push carries the same id, text, author and time the read gives. An edit or a removal (Facebook `verb: edited|remove`) is not kept from the push; the net read keeps the edit. Instagram pushes new comments only.

Shape: `metaComments(body)` (pure) turns `instagram.comments` and `page.feed` (`item: comment`, `verb: add`) changes into `CommentRow`s per account and post. `SocialPush.meta`, switch on, sends each owner's rows to `SocialWatch.keepPushed`: `keepPostComments`, then `catchKeywordDms`, then the executor's `comment` events, as `readPost` does. Those posts no longer wake a read. DM pushes still wake `ReachWatch` and `SocialWatch`.

## 2. A button opens the window

Meta's private reply allows one message per comment, and more only after they answer. ManyChat's first DM carries a button; a tap is their answer, so the window opens.

- `comment_keywords`: `button` (the label, 20 characters at most) and `followup` (what the tap sends). Both null = today.
- The private reply goes out as a button template with one postback button, payload `kw:<hit id>`. Meta's Messenger page says every Send API type is allowed in a private reply, and its example is a button template. The Instagram page shows text only. So a refused template retries once as text alone, with the label in the words: a refused call sent nothing, so the retry is the one reply.
- A tap comes back as a `messaging` push: `postback.payload` (button) or `message.quick_reply.payload`. `metaTaps(body)` (pure) reads `kw:<id>` and the sender. `KeywordDm.followup` sends the follow-up to that sender through `Content.followUp` (`/{page}/messages`, `messaging_type: RESPONSE`), on the send ledger as `followup:<hit>`. A second tap sends nothing. `keyword_hits.followed_at` keeps when.
- Not built: a follow gate (`is_user_follow_business`). The agent's further turns stay with auto-reply (held).

## 3. Pace and reply versions

- `MetaPace/<owner>:<platform>`: a Restate object with each private reply's slot in the last hour. `slot` answers the wait; `KeywordDm` sleeps it before it hands the hit to the ledger. Default 600 an hour (Meta: 750 an hour a professional account for private replies on posts and reels, per vendor guides; Meta's own page did not load), `WREN_META_PRIVATE_PER_HOUR`.
- A keyword's public reply may hold several versions, one a line. The comment's id picks one (a hash, so a replay picks the same).

## Tests

Pure parts only, synthetic ids: the push parse, the tap parse, the version pick, the pace window. Keep twice from one body = no new rows, no new hits (the existing keep tests cover the dedupe).
