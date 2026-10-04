-- Text sorts as people read it: digits by value, so v2 comes before v10.
CREATE COLLATION IF NOT EXISTS "natural" (provider = icu, locale = 'und-u-kn-true');
