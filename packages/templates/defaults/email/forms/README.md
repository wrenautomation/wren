# Form emails

Default copy for emails to people who applied on the site.

- `form-booking`: goes from William's address a few minutes after an applicant's first text, with
  the link to book (`{booking_link}`, the site's own booking page for their offer). None goes to
  someone who already booked.
- `form-booking-no-text`: the same, to an applicant who got no text (a number outside
  `WREN_SMS_FORM_COUNTRIES`, the box unticked, a landline), 2 minutes after they applied.
