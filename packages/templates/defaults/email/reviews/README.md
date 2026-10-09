# Review emails

Default copy for review requests sent by email. They go from portal@ under the client's name,
to customers with no mobile on file or when the client picks email.

- `review-ask`, `review-reminder`: the ask and its one reminder. Both carry the counted link to
  the client's Google review form (`{review_link}`).
- `review-feedback`: one line added to both when the private feedback form is on.

Every email ends with a fixed line to stop these emails. The code adds it, so no template can drop it.
