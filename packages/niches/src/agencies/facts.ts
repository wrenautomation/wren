/**
 * The agencies fact vocabulary: normalized `agency.*` keys.
 *
 * Directory exports speak many dialects ("Min. Project Size", "Avg. Hourly Rate",
 * "Company Size"); every writer translates to these keys at the edge so the
 * targeting surface (`agency_facts`) reads one vocabulary. Values are stored as the
 * source asserted them ("$5,000+", "10 - 49"); the view parses numeric floors in
 * SQL. An absent attribute stays an absent key, never an empty claim.
 *
 * The key list is repeated verbatim in the agency_facts view SQL; amending the
 * vocabulary means a new view revision.
 */

/** fact key -> normalized export headers that carry it. Tight on purpose: a wrong grab pollutes targeting. */
export const HEADER_MAP: Readonly<Record<string, readonly string[]>> = {
  "agency.min_budget": ["min_project_size", "minimum_project_size", "min_budget", "min_spend"],
  "agency.hourly_rate": ["hourly_rate", "avg_hourly_rate", "average_hourly_rate"],
  "agency.team_size": ["team_size", "company_size", "employees", "headcount"],
  "agency.services": ["services", "service_lines", "service_focus"],
  "agency.industries": ["industries", "industry_focus", "verticals"],
  "agency.founded": ["founded", "founded_year", "year_founded", "established"],
  "agency.rating": ["rating", "review_rating"],
};

export const FACT_KEYS: readonly string[] = Object.keys(HEADER_MAP);
