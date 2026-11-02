/** A campaign form's values and the `campaign` map they make; no browser, so tests run bare. */
import type { MetroBody } from "@wren/pipeline/metro";
import {
  type CampaignFields,
  type CampaignStatus,
  CTA_ACTIONS,
} from "@wren/pipeline/metro-campaigns";
import type { Action } from "@wren/pipeline/model";

export interface CampaignValues {
  /** Empty: inherit. */
  status: "" | CampaignStatus;
  from: string;
  until: string;
  offer: string;
  segment: string;
  lines: string[];
  ctas: { label: string; station: string }[];
  accounts: { channel: string; account: string }[];
  caps: { channel: string; act: string; n: string }[];
}

/** The form's values from the group's own fields. */
export const valuesOf = (own: CampaignFields): CampaignValues => ({
  status: own.status ?? "",
  from: own.from ?? "",
  until: own.until ?? "",
  offer: own.offer ?? "",
  segment: own.audience?.segment ?? "",
  lines: [...(own.audience?.lines ?? [])],
  ctas: (own.ctas ?? []).map((c) => ({ label: c.label, station: c.station })),
  accounts: Object.entries(own.accounts ?? {}).map(([channel, account]) => ({ channel, account })),
  caps: Object.entries(own.caps ?? {}).map(([key, n]) => {
    const dot = key.indexOf(".");
    return { channel: key.slice(0, dot), act: key.slice(dot + 1), n: String(n) };
  }),
});

/** The `campaign` map the values make; an empty field or row is left out. */
export function fieldsOf(v: CampaignValues): CampaignFields {
  const t = (s: string) => s.trim();
  const audience = {
    ...(t(v.segment) ? { segment: t(v.segment) } : {}),
    ...(v.lines.length ? { lines: v.lines } : {}),
  };
  const ctas = v.ctas
    .filter((c) => t(c.label) || c.station)
    .map((c) => ({ label: t(c.label), station: c.station }));
  const accounts = Object.fromEntries(
    v.accounts.filter((a) => a.channel && t(a.account)).map((a) => [a.channel, t(a.account)]),
  );
  const caps = Object.fromEntries(
    v.caps
      .filter((c) => c.channel && t(c.act) && t(c.n))
      .map((c) => [`${c.channel}.${t(c.act)}`, Number(t(c.n))]),
  );
  return {
    ...(t(v.offer) ? { offer: t(v.offer) } : {}),
    ...(Object.keys(audience).length ? { audience } : {}),
    ...(ctas.length ? { ctas } : {}),
    ...(Object.keys(accounts).length ? { accounts } : {}),
    ...(Object.keys(caps).length ? { caps } : {}),
    ...(v.from ? { from: v.from } : {}),
    ...(v.until ? { until: v.until } : {}),
    ...(v.status ? { status: v.status } : {}),
  };
}

/** The groups under `id`, itself first. */
function groupsUnder(metro: MetroBody, id: string): Set<string> {
  const under = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of metro.groups)
      if (g.parent && under.has(g.parent) && !under.has(g.id)) {
        under.add(g.id);
        grew = true;
      }
  }
  return under;
}

/** The stations a CTA may point at: in the campaign's group or below it, with a CTA action. */
export function ctaStations(metro: MetroBody, id: string): MetroBody["stations"] {
  const under = groupsUnder(metro, id);
  const ids = new Set(metro.groups.filter((g) => under.has(g.id)).flatMap((g) => g.stations));
  const cta = new Set<Action>(CTA_ACTIONS);
  return metro.stations.filter((s) => ids.has(s.id) && s.action && cta.has(s.action));
}
