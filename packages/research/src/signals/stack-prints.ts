/**
 * Tech stack prints (S4): our own list of the tools that matter to our pitch. Each print is a
 * script host (any URL on that host in the page), a meta tag, an SPF include, a verification TXT
 * or an MX host. ATS prints are `boards.ts`'s, read by `findBoards`, not listed here.
 */

export const STACK_CATEGORIES = [
  "crm",
  "ats",
  "booking",
  "chat",
  "marketing automation",
  "ad pixel",
  "site builder",
  "email host",
] as const;
export type StackCategory = (typeof STACK_CATEGORIES)[number];

export interface StackPrint {
  /** The fact key's last part. */
  tool: string;
  /** As a person says it: "Uses <label>". */
  label: string;
  category: StackCategory;
  /** Hosts; a host matches itself and its subdomains, in any URL on the page. */
  scripts?: string[];
  /** Tested against each `<meta>` tag. */
  meta?: RegExp[];
  /** SPF `include:` hosts; a host matches itself and its subdomains. */
  spf?: string[];
  /** Tested against each TXT record. */
  txt?: RegExp[];
  /** MX hosts; a host matches itself and its subdomains. */
  mx?: string[];
}

const generator = (name: string) =>
  new RegExp(`name=["']generator["'][^>]*content=["'][^"']*${name}`, "i");

export const STACK_PRINTS: readonly StackPrint[] = [
  // CRM
  {
    tool: "hubspot",
    label: "HubSpot",
    category: "crm",
    scripts: [
      "hs-scripts.com",
      "hsforms.net",
      "hs-analytics.net",
      "hs-banner.com",
      "hsforms.com",
      "meetings.hubspot.com",
    ],
    txt: [/^hubspot-developer-verification=/i],
  },
  {
    tool: "salesforce",
    label: "Salesforce",
    category: "crm",
    scripts: ["webto.salesforce.com", "my.salesforce.com", "force.com"],
    spf: ["_spf.salesforce.com"],
  },
  {
    tool: "pipedrive",
    label: "Pipedrive",
    category: "crm",
    scripts: ["pipedrive.com", "pipedriveassets.com"],
  },
  {
    tool: "zoho-crm",
    label: "Zoho CRM",
    category: "crm",
    scripts: ["crm.zoho.com", "crm.zoho.eu", "zohopublic.com"],
  },
  {
    tool: "gohighlevel",
    label: "GoHighLevel",
    category: "crm",
    scripts: ["leadconnectorhq.com", "msgsndr.com", "gohighlevel.com", "highlevel.com"],
  },
  {
    tool: "keap",
    label: "Keap",
    category: "crm",
    scripts: ["infusionsoft.com", "infusionsoft.app", "keap.app"],
  },
  // Booking
  { tool: "calendly", label: "Calendly", category: "booking", scripts: ["calendly.com"] },
  { tool: "cal-com", label: "Cal.com", category: "booking", scripts: ["cal.com"] },
  {
    tool: "acuity",
    label: "Acuity Scheduling",
    category: "booking",
    scripts: ["acuityscheduling.com", "as.me"],
  },
  { tool: "chili-piper", label: "Chili Piper", category: "booking", scripts: ["chilipiper.com"] },
  { tool: "savvycal", label: "SavvyCal", category: "booking", scripts: ["savvycal.com"] },
  // Chat
  {
    tool: "intercom",
    label: "Intercom",
    category: "chat",
    scripts: ["intercom.io", "intercomcdn.com"],
  },
  { tool: "drift", label: "Drift", category: "chat", scripts: ["driftt.com", "drift.com"] },
  {
    tool: "zendesk",
    label: "Zendesk",
    category: "chat",
    scripts: ["zdassets.com", "zopim.com"],
    spf: ["mail.zendesk.com"],
  },
  { tool: "livechat", label: "LiveChat", category: "chat", scripts: ["livechatinc.com"] },
  { tool: "tawk", label: "tawk.to", category: "chat", scripts: ["tawk.to"] },
  { tool: "crisp", label: "Crisp", category: "chat", scripts: ["crisp.chat"] },
  { tool: "tidio", label: "Tidio", category: "chat", scripts: ["tidio.co", "tidiochat.com"] },
  { tool: "freshchat", label: "Freshchat", category: "chat", scripts: ["freshchat.com"] },
  {
    tool: "zoho-salesiq",
    label: "Zoho SalesIQ",
    category: "chat",
    scripts: ["salesiq.zoho.com", "salesiq.zoho.eu"],
  },
  // Marketing automation
  {
    tool: "mailchimp",
    label: "Mailchimp",
    category: "marketing automation",
    scripts: ["chimpstatic.com", "list-manage.com"],
    spf: ["servers.mcsv.net"],
  },
  {
    tool: "activecampaign",
    label: "ActiveCampaign",
    category: "marketing automation",
    scripts: ["trackcmp.net", "activehosted.com"],
  },
  { tool: "klaviyo", label: "Klaviyo", category: "marketing automation", scripts: ["klaviyo.com"] },
  {
    tool: "marketo",
    label: "Marketo",
    category: "marketing automation",
    scripts: ["marketo.net", "marketo.com"],
    spf: ["mktomail.com"],
  },
  { tool: "pardot", label: "Pardot", category: "marketing automation", scripts: ["pardot.com"] },
  {
    tool: "constant-contact",
    label: "Constant Contact",
    category: "marketing automation",
    scripts: ["ctctcdn.com", "constantcontact.com"],
    spf: ["spf.constantcontact.com"],
  },
  {
    tool: "kit",
    label: "Kit (ConvertKit)",
    category: "marketing automation",
    scripts: ["convertkit.com", "ck.page", "kit.com"],
  },
  // Ad pixels
  {
    tool: "meta-ads",
    label: "Meta ads",
    category: "ad pixel",
    scripts: ["connect.facebook.net"],
    txt: [/^facebook-domain-verification=/i],
  },
  {
    tool: "google-ads",
    label: "Google Ads",
    category: "ad pixel",
    scripts: ["googleadservices.com", "googleads.g.doubleclick.net"],
  },
  {
    tool: "linkedin-ads",
    label: "LinkedIn ads",
    category: "ad pixel",
    scripts: ["snap.licdn.com", "px.ads.linkedin.com"],
  },
  {
    tool: "tiktok-ads",
    label: "TikTok ads",
    category: "ad pixel",
    scripts: ["analytics.tiktok.com"],
  },
  {
    tool: "x-ads",
    label: "X ads",
    category: "ad pixel",
    scripts: ["static.ads-twitter.com", "ads-twitter.com"],
  },
  {
    tool: "microsoft-ads",
    label: "Microsoft ads",
    category: "ad pixel",
    scripts: ["bat.bing.com"],
  },
  // Site builders
  {
    tool: "wordpress",
    label: "WordPress",
    category: "site builder",
    meta: [generator("WordPress")],
  },
  {
    tool: "wix",
    label: "Wix",
    category: "site builder",
    scripts: ["wixstatic.com", "parastorage.com"],
    meta: [generator("Wix")],
  },
  {
    tool: "squarespace",
    label: "Squarespace",
    category: "site builder",
    scripts: ["squarespace.com", "sqspcdn.com"],
  },
  {
    tool: "webflow",
    label: "Webflow",
    category: "site builder",
    scripts: ["website-files.com"],
    meta: [generator("Webflow")],
  },
  { tool: "shopify", label: "Shopify", category: "site builder", scripts: ["cdn.shopify.com"] },
  {
    tool: "godaddy-builder",
    label: "GoDaddy Website Builder",
    category: "site builder",
    scripts: ["wsimg.com"],
    meta: [generator("Go Daddy")],
  },
  { tool: "duda", label: "Duda", category: "site builder", scripts: ["cdn-website.com"] },
  // Email hosts
  {
    tool: "google-workspace",
    label: "Google Workspace",
    category: "email host",
    mx: ["google.com", "googlemail.com"],
    spf: ["_spf.google.com"],
  },
  {
    tool: "microsoft-365",
    label: "Microsoft 365",
    category: "email host",
    mx: ["mail.protection.outlook.com"],
    spf: ["spf.protection.outlook.com"],
    txt: [/^MS=ms\d+/],
  },
  {
    tool: "zoho-mail",
    label: "Zoho Mail",
    category: "email host",
    mx: ["zoho.com", "zoho.eu", "zoho.in"],
    spf: ["zoho.com", "zoho.eu", "zoho.in"],
    txt: [/^zoho-verification=/i],
  },
  {
    tool: "proton-mail",
    label: "Proton Mail",
    category: "email host",
    mx: ["protonmail.ch"],
    spf: ["_spf.protonmail.ch"],
    txt: [/^protonmail-verification=/i],
  },
  {
    tool: "godaddy-email",
    label: "GoDaddy email",
    category: "email host",
    mx: ["secureserver.net"],
  },
];
