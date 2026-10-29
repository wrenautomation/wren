# calendar: schema

Tables and views: 2.

## calendar.booking_records (view)

- `booked timestamp with time zone null`
- `calendar text null`
- `cancelled_at timestamp with time zone null`
- `code text null`
- `email text null`
- `id integer null`
- `marked timestamp with time zone null`
- `marked_by text null`
- `meet text null`
- `name text null`
- `offer text null`
- `outcome_reason text null`
- `reason text null`
- `source text null`
- `start timestamp with time zone null`
- `status text null`
- `zone text null`

## calendar.bookings (table)

- `application varchar(64) null`
- `calendar varchar(64) = 'wren'::character varying`
- `cancelled_at timestamp with time zone null`
- `cancelled_by varchar(320) null`
- `code varchar(40) null`
- `created_at timestamp with time zone = now()`
- `email varchar(320)`
- `end timestamp with time zone`
- `google_event_id varchar(1024) null`
- `id integer = nextval('calendar.bookings_id_seq'::regclass)`
- `meet_url text null`
- `name text`
- `offer varchar(64) null`
- `reason text null`
- `reminded_day_at timestamp with time zone null`
- `reminded_hour_at timestamp with time zone null`
- `source jsonb = '{}'::jsonb`
- `start timestamp with time zone`
- `state varchar(16) = 'booked'::character varying`
- `updated_at timestamp with time zone = now()`
- `zone varchar(64)`

Indexes:

- `CREATE INDEX ix_calendar_bookings_email ON calendar.bookings USING btree (lower((email)::text))`
- `CREATE INDEX ix_calendar_bookings_start ON calendar.bookings USING btree (start)`
- `CREATE UNIQUE INDEX pk_bookings ON calendar.bookings USING btree (id)`
- `CREATE UNIQUE INDEX uq_calendar_bookings_slot ON calendar.bookings USING btree (calendar, start) WHERE ((state)::text = 'booked'::text)`
