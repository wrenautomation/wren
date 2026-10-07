# YouTube footers

The text under every YouTube upload's description, after the chapters, with a blank line
between. Approve (`approveVideo`, `packages/content/src/video.ts`) picks one by the upload's kind.

- `footer`: a long video, and a vertical over 3 minutes (YouTube files it as a video). Links
  first: the site, then booking, then the other socials, one per line. Then the bio.
- `shorts-footer`: a Short, and a vertical of 3 minutes or less. Links in a Short's
  description can't be clicked, so it is plain text: the site and a one-line bio.

`{video}` is the video's slug: its id, then its title's first words, lowercase with dashes
(`12-how-id-fix-cold-email`, `videoSlug`). It becomes the link's `utm_campaign` through the
lander's `/go/yt/<campaign>`, so a visit says which video sent it. The booking link adds
`/book` (`utm_content`) and lands on `/book/reactivation`, the only offer with a booking page;
its Cal.com event is the general call. The booking keeps the utm on Wren's own calendar
(`BOOKING = "wren"`); on Cal.com it would drop it.

Edit with `wren templates get post:youtube/footer` and `set`, or in Library, Templates.
Making a version live waits in To approve.
