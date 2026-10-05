DROP VIEW "books"."subscription_records";--> statement-breakpoint
CREATE VIEW "books"."subscription_records" AS (
    select concat_ws('/', s.vendor_id, lower(coalesce(s.plan, '')), s.cycle, s.last_billed_on) id,
      coalesce(s.vendor_name, s.vendor)::text vendor, s.plan, s.cycle::text cycle,
      s.last_total_cents / 100.0 cost, s.currency::text currency,
      s.monthly_cad_cents / 100.0 monthly, 'CAD' cad, s.last_billed_on, s.renews_on,
      case when s.renews_on < current_date then 'past'
        when s.renews_on < current_date + 30 then 'soon' else 'later' end renewal,
      s.since, s.bills,
      -- The last bill's charged lines name the edition ("Max plan - 20x") a one-plan vendor hides.
      (select string_agg(l.description, '; ' order by l.position) from books.bill_lines l
        where l.amount_cents > 0 and l.bill_id = (select b.id from books.bills b
          where b.vendor_id = s.vendor_id and b.issued_on = s.last_billed_on
            and lower(coalesce(b.plan, '')) = lower(coalesce(s.plan, ''))
          order by b.id desc limit 1)) billed_for
    from books.subscriptions s);