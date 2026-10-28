# calendar: schema

Tables and views: 2.

## calendar.bookings (table)

- `id integer = nextval('calendar.bookings_id_seq'::regclass)`
- `calendar varchar(64) = 'wren'::character varying`
- `state varchar(16) = 'booked'::character varying`
- `start timestamp with time zone`
- `end timestamp with time zone`
- `name text`
- `email varchar(320)`
- `zone varchar(64)`
- `offer varchar(64) null`
- `code varchar(40) null`
- `application varchar(64) null`
- `source jsonb = '{}'::jsonb`
- `google_event_id varchar(1024) null`
- `meet_url text null`
- `reminded_day_at timestamp with time zone null`
- `reminded_hour_at timestamp with time zone null`
- `cancelled_at timestamp with time zone null`
- `cancelled_by varchar(320) null`
- `reason text null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_bookings ON calendar.bookings USING btree (id)`
- `CREATE UNIQUE INDEX uq_calendar_bookings_slot ON calendar.bookings USING btree (calendar, start) WHERE ((state)::text = 'booked'::text)`
- `CREATE INDEX ix_calendar_bookings_email ON calendar.bookings USING btree (lower((email)::text))`
- `CREATE INDEX ix_calendar_bookings_start ON calendar.bookings USING btree (start)`

## calendar.booking_records (view)

- `id integer null`
- `calendar text null`
- `name text null`
- `email text null`
- `status text null`
- `start timestamp with time zone null`
- `zone text null`
- `offer text null`
- `code text null`
- `source text null`
- `meet text null`
- `booked timestamp with time zone null`
- `cancelled_at timestamp with time zone null`
- `reason text null`
- `outcome_reason text null`
- `marked_by text null`
- `marked timestamp with time zone null`
