# Reddit karma: places where young accounts earn it

2026-10-18. Bead wa-23s. Both warming accounts had 2 to 3 karma after a week of comments. All of those comments went to business subs, and those subs filter new accounts. About half were hidden. So the accounts stayed young.

## Decisions

- A karma place is a reddit place with `purpose = 'karma'` (migration 0293). Both purposes use the same place, watch, thread, draft and send steps.
- The list is `KARMA_PLACES` in `discovery/places.ts`: large general and help subs that take new accounts. Wren's RedditReads pass upserts it each pass. A client's pass has none. The migration seeds no rows, because migrations also run in client and test databases.
- A place already on file joins the list as karma and is read again. Its found-by stays the same.
- The judge reads a karma place without the audience line. Rules that forbid our comments skip it. A stated karma or age floor above both accounts leaves it `found`. Otherwise it watches itself on the account with fewer karma places. William still picks the reach places.
- Signed-out reads of about and rules get 403 (since 2026-10-13). So a karma place is read signed in as one of our accounts, on that account's cap. When that cap is spent, the read goes signed out.
- Karma threads: at most 6 hours old and at most 15 comments. They are ranked newest first, queued and drafted first, and go stale after 6 hours.
- One drafter, `draftThread`, with a `karma` flag. The flag sets a prompt for a short helpful answer, with no facts and no posts. `pitchIn` looks for Wren, a link, a domain or "dm me". If it finds one, the draft runs once more. A second miss drops the thread.
- The comment rung is 5 a day per account. Under 50 karma, business (reach) places get at most 2 of the 5. Karma places get the rest, plus any reach room not used. A reach backlog that is over its share never takes karma room.
- The send holds a third business comment of the day with `ThreadHeld`. The scheduler takes reach slots that are over the share off the schedule, and slots them again at 2 a day. The `reddit_requirements` gate stays as it was. A business sub that holds us stays held.
- Reddit thread hours: 8:00 to 22:00 Toronto time, every day. Weekends were already open. DMs and LinkedIn keep weekdays 10:00 to 17:00.
- The day cap counts the lane's day in Toronto, not the UTC day. A send at 21:00 now counts on that day.
- Karma places have their own listing: 1 page, every 2 hours. Their volume would push the reach posts off the page, and fill `reddit_threads`.
- The Places record has a "For" column (Reach or Karma) and a Karma view.

## Not built

- The list is in code, not in settings. A new sub is a commit.
- `answerComment` (a reply under our own comment) counts toward the day total. It does not count toward the business share.
- If a karma place's floor is stated only in AutoModerator, it shows after a removal. Then a `reddit_requirements` hold stops it.
