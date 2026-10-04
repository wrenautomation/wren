/** Meta ads: launch, watch and pull leads from lead forms. */
import { defineComponent } from "@wren/core/components";

export const META_COMPONENTS = [
  defineComponent({
    id: "ads.meta",
    name: "Meta ads",
    blurb: "Launches Meta ads with lead forms and watches their spend and leads.",
    icon: "money",
    for: "client",
    ready: false,
    missing: ["Runs on Wren's ad account, not per client"],
    requires: { accounts: ["meta"] },
    provides: { services: ["Ads", "AdsWatch"], loops: ["AdsWatch"] },
    effects: ["spends", "posts"],
  }),
];
