-- Synthetic firms for the portal-reads scenario, shaped like prod on 2026-10-11: per firm about
-- 1.1 documents, 1.6 people and 0.8 leads, 45% of those verified and named; three niches, a
-- year of adds, one in 17 declined. No real data. The guard reads the viewer's seat fresh, so
-- the scenario's viewer gets one.
insert into operators (email) values ('load@example.test');

insert into companies (domain, name, niche, created_at, decline_reason)
select
  'firm-' || g || '.example.test',
  'Synthetic Firm ' || g,
  (array['load-a', 'load-b', 'load-c'])[1 + g % 3],
  now() - (g % 365) * interval '1 day',
  case when g % 17 = 0 then 'synthetic decline' end
from generate_series(1, :firms) g;

-- 70% crawled, half of those twice.
insert into documents (company_id, url, kind, content_hash, text, fetched_at)
select c.id, 'https://' || c.domain || '/p' || n, 'webpage', md5(c.id || '-' || n), 'synthetic',
  c.created_at + n * interval '1 hour'
from companies c, generate_series(1, 2) n
where c.id % 10 < 7 and (n = 1 or c.id % 2 = 0);

-- Two people at 80% of firms.
insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw, created_at)
select c.id, 'Person ' || c.id || '-' || n, false, 'website', 'load', '{}',
  c.created_at + interval '2 hours'
from companies c, generate_series(1, 2) n
where c.id % 10 < 8;

insert into imports (source_type, source_ref, stats) values ('load', 'load', '{}');

-- A lead for half the people; 45% of firms' leads verified and named.
insert into leads (company_id, person_id, email, status, first_name, raw, import_id, created_at)
select p.company_id, p.id, 'p' || p.id || '@' || c.domain,
  case when p.company_id % 20 < 9 then 'verified' else 'imported' end,
  'Person', '{}', (select max(id) from imports), p.created_at + interval '1 hour'
from people p join companies c on c.id = p.company_id
where p.id % 2 = 0;

analyze;
