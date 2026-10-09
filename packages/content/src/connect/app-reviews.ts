/**
 * The platform reviews Wren's social apps wait on (designs/2026-10-09-app-reviews.md): what each needs,
 * the text to paste, the screencast to record, and live checks of the public pages and callbacks
 * they point at. `wren app-reviews` prints a packet; submitting stays a person's act on the
 * platform's own console. Pure apart from the injected fetch and file reader.
 */
import { SOCIAL, type SocialApp, type SocialPlatform } from "./platforms.js";

export const SITE = "https://wrenautomation.com";
export const PORTAL = "https://app.wrenautomation.com";
export const PRIVACY = `${SITE}/privacy`;
export const TERMS = `${SITE}/terms`;
export const DELETION = `${SITE}/data-deletion`;
/** The test client reviewers sign in to (prod client `wren_test`). */
export const REVIEWER_PORTAL = "https://portal.wrenautomationreviews.com";
/** 1024 square, the size Meta and TikTok ask for; the others scale it down. */
export const ICON = "deploy/reviews/app-icon-1024.png";

export const callbackOf = (p: SocialPlatform) => `${PORTAL}/oauth/social/${p}`;
/** The mail apps' callbacks (designs/2026-10-07-mail-access.md). */
export const mailCallbackOf = (p: "google" | "microsoft") => `${PORTAL}/oauth/mail/${p}`;

/** Something a review needs that a machine can check. */
export type Need =
  | { kind: "page"; url: string; has: readonly string[]; why: string }
  | { kind: "callback"; url: string }
  | { kind: "key"; name: string }
  | { kind: "icon" };

export interface Review {
  id: string;
  name: string;
  app: SocialApp | "meta-business" | "whatsapp" | "mail-google" | "mail-microsoft";
  /** The platforms it lets every client connect (`WREN_SOCIAL_LIVE` once it passes). */
  unlocks: readonly SocialPlatform[];
  /** Where it's filed. */
  where: string;
  /** Reviews this one waits on. */
  after: readonly string[];
  /** Filed already: when and what. Null until then. */
  filed: string | null;
  needs: readonly Need[];
  /** Form fields, as the console labels them. */
  fields: readonly (readonly [string, string])[];
  /** Each scope or permission and how Wren uses it, for the form's per-scope box. */
  scopes: readonly (readonly [string, string])[];
  /** The screencast, one shot per line. Empty when the review takes none. */
  video: readonly string[];
  /** What only a person can supply, or a known gap a check can't see. */
  open: readonly string[];
}

const DESCRIPTION =
  "Wren is a marketing and client-communication app for small businesses. A business connects its own accounts, then plans and approves posts, reads comments, messages and reviews in one inbox, and approves each reply before it goes out from its own account.";

const REVIEWER = [
  `Sign in at ${REVIEWER_PORTAL} with the reviewer login in the notes field (a test business, "Wren test firm").`,
  "Open Account, then Social. Each platform's Connect button starts its sign-in.",
];

const page = (url: string, has: readonly string[], why: string): Need => ({
  kind: "page",
  url,
  has,
  why,
});
const privacy = (has: readonly string[], why: string) => page(PRIVACY, has, why);
const keys = (app: string): Need[] => [
  { kind: "key", name: `WREN_SOCIAL_${app}_CLIENT_ID` },
  { kind: "key", name: `WREN_SOCIAL_${app}_CLIENT_SECRET` },
];

const cb = (p: SocialPlatform): Need => ({ kind: "callback", url: callbackOf(p) });
/** Google user data reaches only this model: it must be one that doesn't train on it. */
const GOOGLE_LLM: Need = { kind: "key", name: "WREN_GOOGLE_LLM" };

const META_WHY: Record<string, string> = {
  pages_show_list: "Lists the Pages the person manages so they pick the one Wren posts as.",
  pages_read_engagement: "Reads the Page's posts and their likes, comments and shares for reports.",
  pages_manage_posts: "Publishes the posts the business approves in Wren to its own Page.",
  pages_read_user_content: "Reads comments on the Page's posts into the business's inbox.",
  pages_manage_engagement: "Sends the comment replies the business approves, as the Page.",
  pages_messaging:
    "Reads Page messages into the inbox and sends the replies the business approves, inside Messenger's 24-hour window.",
  business_management:
    "Finds Pages owned through a Business portfolio, for businesses set up that way.",
  instagram_basic: "Reads the linked Instagram account's profile and posts.",
  instagram_content_publish:
    "Publishes the posts the business approves to its own Instagram account.",
  instagram_manage_comments: "Reads comments into the inbox and sends the approved replies.",
  instagram_manage_messages: "Reads Instagram DMs into the inbox and sends the approved replies.",
};

const GOOGLE_WHY: Record<string, string> = {
  "https://www.googleapis.com/auth/youtube.upload":
    "Uploads the videos the business approves in Wren to its own channel.",
  "https://www.googleapis.com/auth/youtube.force-ssl":
    "Reads comments on the channel's videos into the inbox and posts the replies the business approves.",
  "https://www.googleapis.com/auth/youtube.readonly":
    "Reads the channel's videos and their view, like and comment counts for reports.",
  "https://www.googleapis.com/auth/business.manage":
    "Publishes approved posts to the business's own Google Business Profile, reads its reviews into the inbox, and posts the approved answers.",
};

const TIKTOK_WHY: Record<string, string> = {
  "user.info.basic": "Shows which TikTok account is connected (name and avatar).",
  "user.info.stats": "Reads follower and like counts for the business's reports.",
  "video.list": "Reads the account's videos and their views for reports.",
  "video.upload": "Sends an approved video to the creator's TikTok inbox as a draft.",
  "video.publish":
    "Posts an approved video directly, with the settings the creator picks on the post page.",
};

const LINKEDIN_WHY: Record<string, string> = {
  r_organization_social: "Reads the company page's posts and comments into the inbox and reports.",
  w_organization_social: "Publishes approved posts and comment replies as the company page.",
  rw_organization_admin: "Finds the pages the person administers and reads follower counts.",
};

const why = (table: Record<string, string>, scopes: readonly string[]) =>
  scopes.map((s) => [s, table[s] ?? "Not described yet."] as const);

const META_SCOPES = [...new Set([...SOCIAL.facebook.scopes, ...SOCIAL.instagram.scopes])];
const GOOGLE_SCOPES = [...SOCIAL.youtube.scopes, ...SOCIAL.google_business.scopes];

export const REVIEWS: readonly Review[] = [
  {
    id: "meta-business",
    name: "Meta Business Verification",
    app: "meta-business",
    unlocks: [],
    where: "https://business.facebook.com/settings/security",
    after: [],
    filed: null,
    needs: [page(SITE, ["Wren Automation"], "the website Meta matches the business name against")],
    fields: [
      ["Legal business name", "Wren Automation (sole proprietorship of William Jin)"],
      ["Website", SITE],
      ["Country", "Canada"],
    ],
    scopes: [],
    video: [],
    open: [
      "William: a document with the legal name and address (registration, or a utility or bank statement in the business name), and the business phone that takes Meta's code.",
    ],
  },
  {
    id: "meta-app",
    name: "Meta App Review (Advanced Access)",
    app: "meta",
    unlocks: ["facebook", "instagram"],
    where: "https://developers.facebook.com/apps/",
    after: ["meta-business"],
    filed: null,
    needs: [
      ...keys("META"),
      cb("facebook"),
      cb("instagram"),
      privacy(
        ["Facebook", "Instagram", "delete"],
        "privacy policy that covers Page and Instagram data",
      ),
      page(DELETION, ["Facebook", "Disconnect"], "Data Deletion Instructions URL"),
      { kind: "icon" },
    ],
    fields: [
      ["App category", "Business and pages"],
      ["Privacy policy URL", PRIVACY],
      ["Terms of service URL", TERMS],
      ["User data deletion", `Data deletion instructions URL: ${DELETION}`],
      ["App domains", "wrenautomation.com, app.wrenautomation.com"],
      ["Valid OAuth redirect URIs", `${callbackOf("facebook")}, ${callbackOf("instagram")}`],
      ["App icon", ICON],
      ["Description", DESCRIPTION],
      ["Reviewer instructions", REVIEWER.join(" ")],
    ],
    scopes: why(META_WHY, META_SCOPES),
    video: [
      `Sign in at ${REVIEWER_PORTAL}; open Account, Social.`,
      "Press Connect on Facebook Page. Facebook's dialog shows every permission; pick the test Page; accept.",
      "Back in Wren the Page shows Connected.",
      "Marketing, Content: write a post for the Page, approve it, publish. Open the Page on Facebook to show it there (pages_manage_posts).",
      "Comment on that post from a second account. Marketing, Inbox shows the comment (pages_read_user_content); approve a reply; show it on Facebook (pages_manage_engagement).",
      "Message the Page from the second account. The Inbox shows it; approve a reply; show it in Messenger (pages_messaging).",
      "Marketing, Reports: the post's reach and engagement (pages_read_engagement).",
      "Repeat Connect for Instagram business (linked to the Page): publish, read a comment and reply, read a DM and reply (instagram_*).",
      "Account, Social: Disconnect. The account shows Not connected.",
    ],
    open: [
      "Each permission's screencast must show that permission's own use; the shot list marks which.",
    ],
  },
  {
    id: "google-oauth",
    name: "Google OAuth verification (sensitive scopes)",
    app: "google",
    unlocks: ["youtube", "google_business"],
    where: "https://console.cloud.google.com/auth/verification?project=wren-social",
    after: [],
    filed: null,
    needs: [
      ...keys("GOOGLE"),
      cb("youtube"),
      cb("google_business"),
      GOOGLE_LLM,
      privacy(
        ["Google API Services User Data Policy", "Limited Use"],
        "privacy policy with the Limited Use statement",
      ),
      page(SITE, ["privacy"], "home page on the authorized domain, linking the privacy policy"),
    ],
    fields: [
      ["App name", "Wren"],
      ["User support email", "william@wrenautomation.com"],
      ["Application home page", SITE],
      ["Application privacy policy link", PRIVACY],
      ["Application terms of service link", TERMS],
      ["Authorized domains", "wrenautomation.com"],
      ["Authorized redirect URIs", `${callbackOf("youtube")}, ${callbackOf("google_business")}`],
      ["Description", DESCRIPTION],
    ],
    scopes: why(GOOGLE_WHY, GOOGLE_SCOPES),
    video: [
      `Sign in at ${REVIEWER_PORTAL}; open Account, Social; press Connect on YouTube channel.`,
      "Google's consent screen: show the app name and the address bar with the client id, then each scope; allow.",
      "Back in Wren the channel shows Connected.",
      "Marketing, Content: approve a video and upload it; show it on YouTube Studio (youtube.upload).",
      "A comment on the video shows in Marketing, Inbox; approve a reply; show it on YouTube (youtube.force-ssl).",
      "Marketing, Reports: the video's views and likes (youtube.readonly).",
      "Connect Google Business Profile the same way: a post published, a review read into the Inbox and answered (business.manage).",
      "Disconnect in Account, Social; show the app gone from myaccount.google.com/permissions after removing it there.",
    ],
    open: [
      "Upload the video unlisted on YouTube; the form takes its link.",
      "Limited Use: a client's Google data (YouTube comments, Business Profile reviews, Gmail) reaches only WREN_GOOGLE_LLM, and nothing while it's unset. Set it to a model whose provider doesn't train on input (a paid key: William's call) before filing, and before the lander's Limited Use line goes live.",
    ],
  },
  {
    id: "youtube-audit",
    name: "YouTube API Services audit",
    app: "google",
    unlocks: ["youtube"],
    where: "https://support.google.com/youtube/contact/yt_api_form",
    after: ["google-oauth"],
    filed: null,
    needs: [
      page(TERMS, ["YouTube Terms of Service"], "terms that bind users to YouTube's terms"),
      privacy(
        [
          "YouTube API Services",
          "Google Privacy Policy",
          "security.google.com/settings/security/permissions",
        ],
        "privacy policy naming YouTube API Services, Google's policy and the revoke link",
      ),
    ],
    fields: [
      ["Project", "wren-social"],
      [
        "Use case",
        "Publishing approved videos and answering comments for a business's own channel",
      ],
      ["Website", SITE],
      ["Description", DESCRIPTION],
    ],
    scopes: [],
    video: ["The google-oauth screencast covers it; the form takes the same link."],
    open: [
      "Lifts the private-only lock on uploads from an unaudited project and raises the quota.",
    ],
  },
  {
    id: "tiktok-app",
    name: "TikTok app review (production)",
    app: "tiktok",
    unlocks: ["tiktok"],
    where: "https://developers.tiktok.com/apps/",
    after: [],
    filed: null,
    needs: [
      ...keys("TIKTOK"),
      cb("tiktok"),
      privacy(["TikTok"], "privacy policy that covers TikTok data"),
      page(TERMS, ["Wren"], "terms of service"),
      { kind: "icon" },
    ],
    fields: [
      ["App name", "Wren"],
      ["Category", "Business"],
      ["Platform", "Web"],
      ["Website URL", SITE],
      ["Terms of Service URL", TERMS],
      ["Privacy Policy URL", PRIVACY],
      ["Redirect URI", callbackOf("tiktok")],
      ["Products", "Login Kit, Content Posting API (Direct Post on)"],
      ["Description", DESCRIPTION],
    ],
    scopes: why(TIKTOK_WHY, SOCIAL.tiktok.scopes),
    video: [
      `Sign in at ${REVIEWER_PORTAL} (show the address bar: the domain is the one on the app).`,
      "Account, Social: Connect TikTok; TikTok's authorize page lists each scope; authorize.",
      "Back in Wren: the account shows Connected with its name and avatar (user.info.basic).",
      "Marketing, Content: open a video post for TikTok. Its post page shows the creator's name and avatar, the privacy choice with nothing picked, comments, duet and stitch all off, and the commercial content disclosure.",
      "Pick a privacy level, tick the declaration, post. Show it on TikTok (video.publish, video.upload).",
      "Marketing, Reports: followers and the video's views (user.info.stats, video.list).",
    ],
    open: ["Record on the production domain; TikTok rejects a localhost demo."],
  },
  {
    id: "tiktok-direct-post",
    name: "TikTok Direct Post audit",
    app: "tiktok",
    unlocks: ["tiktok"],
    where: "https://developers.tiktok.com/application/content-posting-api",
    after: ["tiktok-app"],
    filed: null,
    needs: [],
    fields: [
      ["Expected daily posts", "Under 50 across all businesses at launch"],
      [
        "Post page",
        "Follows TikTok's content sharing guidelines (designs/2026-10-07-client-social.md, Direct Post)",
      ],
    ],
    scopes: [],
    video: ["The tiktok-app screencast's post page shots; the audit asks for the same flow."],
    open: ["Until it passes, every post is private (SELF_ONLY)."],
  },
  {
    id: "linkedin-pages",
    name: "LinkedIn Community Management API",
    app: "linkedin_pages",
    unlocks: ["linkedin_page"],
    where: "https://www.linkedin.com/developers/apps/264113599/products",
    after: [],
    filed: "2026-10-09: Development tier access form (Microsoft vetting email next)",
    needs: [...keys("LINKEDIN_PAGES"), cb("linkedin_page")],
    fields: [
      ["App", "Wren Pages (264113599)"],
      ["Redirect URL", callbackOf("linkedin_page")],
    ],
    scopes: why(LINKEDIN_WHY, SOCIAL.linkedin_page.scopes),
    video: [
      "Standard tier (after Development): Connect a company page in Account, Social; publish an approved post; read a comment into the Inbox and reply; show follower counts in Reports.",
    ],
    open: ["William: the vetting service's document asks (registration, ID)."],
  },
  {
    id: "google-business",
    name: "Google Business Profile API access",
    app: "google",
    unlocks: ["google_business"],
    where: "https://support.google.com/business/contact/api_default",
    after: [],
    filed: null,
    needs: [page(SITE, ["Wren"], "the website on the request")],
    fields: [
      ["Project number", "wren-social's (Cloud console, project settings)"],
      ["Contact email", "william@wrenautomation.com"],
      ["Website", SITE],
      [
        "Use",
        "Publishing approved local posts and answering reviews on Profiles the business owns",
      ],
    ],
    scopes: [],
    video: [],
    open: [
      "Google asks for a verified Business Profile tied to the website that has been active 60 days or more.",
    ],
  },
  {
    id: "google-mail",
    name: "Google OAuth verification, Wren mail app (send only)",
    app: "mail-google",
    unlocks: [],
    where: "https://console.cloud.google.com/auth/verification",
    after: [],
    filed: null,
    needs: [
      { kind: "key", name: "WREN_MAIL_GOOGLE_CLIENT_ID" },
      { kind: "key", name: "WREN_MAIL_GOOGLE_CLIENT_SECRET" },
      { kind: "callback", url: mailCallbackOf("google") },
      GOOGLE_LLM,
      privacy(["Limited Use", "Gmail"], "privacy policy covering connected mailboxes"),
    ],
    fields: [
      ["App name", "Wren mail"],
      ["User support email", "william@wrenautomation.com"],
      ["Application home page", SITE],
      ["Application privacy policy link", PRIVACY],
      ["Application terms of service link", TERMS],
      ["Authorized domains", "wrenautomation.com"],
      ["Authorized redirect URIs", mailCallbackOf("google")],
      ["Description", DESCRIPTION],
    ],
    scopes: [
      [
        "https://www.googleapis.com/auth/gmail.send",
        "Sends the replies the business approves in Wren from its own mailbox, in the thread the customer wrote in.",
      ],
    ],
    video: [
      `Sign in at ${REVIEWER_PORTAL}; open Account, Mail; press Connect on a Gmail mailbox.`,
      "Google's consent screen: the app name, the client id in the address bar, the send scope; allow.",
      "Back in Wren the mailbox shows Connected, send only.",
      "Marketing, Inbox: approve a reply on an email thread; show it in that mailbox's Sent folder.",
      "Disconnect in Account, Mail.",
    ],
    open: [
      "Verify send only. Reading (gmail.readonly) is a restricted scope with a yearly CASA assessment, so it stays on Workspace trust: a client's admin trusts the app, and personal Gmail gets send only (designs/2026-10-07-mail-access.md). CASA is money: William's call.",
      "Upload the video unlisted on YouTube; the form takes its link.",
    ],
  },
  {
    id: "microsoft-mail",
    name: "Microsoft publisher verification, Wren mail app",
    app: "mail-microsoft",
    unlocks: [],
    where: "https://entra.microsoft.com (App registrations, Wren mail, Branding & properties)",
    after: [],
    filed: null,
    needs: [
      { kind: "key", name: "WREN_MAIL_MICROSOFT_CLIENT_ID" },
      { kind: "key", name: "WREN_MAIL_MICROSOFT_CLIENT_SECRET" },
      { kind: "callback", url: mailCallbackOf("microsoft") },
      privacy(["Microsoft 365"], "privacy policy covering connected mailboxes"),
      page(TERMS, ["Wren app"], "terms of service"),
    ],
    fields: [
      ["Publisher domain", "wrenautomation.com"],
      ["Home page URL", SITE],
      ["Terms of service URL", TERMS],
      ["Privacy statement URL", PRIVACY],
      ["MPN ID", "the Partner ID from the Microsoft AI Cloud Partner Program"],
    ],
    scopes: [],
    video: [],
    open: [
      "Needs a Microsoft AI Cloud Partner Program Partner ID (free), on an account whose email domain is wrenautomation.com; it verifies the business's legal name and address. That enrollment is held with Meta business verification.",
      "Without it the app works; a client's admin sees an unverified publisher on consent.",
    ],
  },
  {
    id: "whatsapp-provider",
    name: "WhatsApp Tech Provider",
    app: "whatsapp",
    unlocks: [],
    where: "https://developers.facebook.com/apps/",
    after: ["meta-business"],
    filed: null,
    needs: [],
    fields: [],
    scopes: [],
    video: [
      "Sending a message from the app to a WhatsApp number.",
      "Creating a message template in the app.",
    ],
    open: ["The WhatsApp channel isn't built. File once it is (designs/2026-10-09-site-chat.md)."],
  },
];

export const reviewOf = (id: string) => REVIEWS.find((r) => r.id === id) ?? null;

export interface Check {
  need: string;
  ok: boolean;
  detail: string;
}

export interface CheckDeps {
  fetch: (url: string) => Promise<{ status: number; text: () => Promise<string> }>;
  /** Whether an env name is set; null when the env isn't loaded here. */
  hasKey: (name: string) => boolean | null;
  /** The icon file's bytes, or null when missing. */
  icon: () => Promise<Uint8Array | null>;
}

const squarePng = (b: Uint8Array) => {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
};

/** Each need, checked live. Pages are fetched once each. */
export async function checkReview(r: Review, deps: CheckDeps): Promise<Check[]> {
  const pages = new Map<string, Promise<{ status: number; body: string }>>();
  const load = (url: string) => {
    let p = pages.get(url);
    if (!p) {
      p = deps
        .fetch(url)
        .then(async (res) => ({ status: res.status, body: await res.text() }))
        .catch((err: unknown) => ({ status: 0, body: String(err) }));
      pages.set(url, p);
    }
    return p;
  };
  const out: Check[] = [];
  for (const n of r.needs) {
    if (n.kind === "page") {
      const { status, body } = await load(n.url);
      const text = body.toLowerCase();
      const missing = n.has.filter((h) => !text.includes(h.toLowerCase()));
      out.push({
        need: `${n.why} (${n.url})`,
        ok: status === 200 && missing.length === 0,
        detail:
          status !== 200
            ? `answers ${status || "nothing"}`
            : missing.length
              ? `missing ${missing.map((m) => `"${m}"`).join(", ")}`
              : "ok",
      });
    } else if (n.kind === "callback") {
      // Without a sign-in in flight the callback refuses with 400; a 404 means it isn't served.
      const { status } = await load(n.url);
      out.push({
        need: `callback ${n.url}`,
        ok: status > 0 && status !== 404 && status < 500,
        detail: status === 404 || status === 0 || status >= 500 ? `answers ${status}` : "served",
      });
    } else if (n.kind === "key") {
      const has = deps.hasKey(n.name);
      out.push({
        need: `key ${n.name}`,
        ok: has === true,
        detail: has === null ? "env not loaded here" : has ? "set" : "missing",
      });
    } else {
      const bytes = await deps.icon();
      const size = bytes ? squarePng(bytes) : null;
      out.push({
        need: `icon ${ICON}`,
        ok: size?.w === 1024 && size.h === 1024,
        detail: size ? `${size.w}x${size.h}` : bytes ? "not a PNG" : "missing",
      });
    }
  }
  return out;
}

/** The packet as Markdown: fields to paste, scope text, the screencast, open items, checks. */
export function packetOf(r: Review, checks: readonly Check[] | null): string {
  const lines = [
    `# ${r.name}`,
    "",
    `Filed: ${r.filed ?? "not yet. Filing is held for William's yes."}`,
  ];
  lines.push(`Where: ${r.where}`);
  if (r.after.length) lines.push(`After: ${r.after.join(", ")}`);
  if (r.unlocks.length) lines.push(`Unlocks: ${r.unlocks.map((p) => SOCIAL[p].label).join(", ")}`);
  if (r.fields.length) {
    lines.push("", "## Fields", "");
    for (const [k, v] of r.fields) lines.push(`- ${k}: ${v}`);
  }
  if (r.scopes.length) {
    lines.push("", "## Permissions", "");
    for (const [s, w] of r.scopes) lines.push(`- \`${s}\`: ${w}`);
  }
  if (r.video.length) {
    lines.push("", "## Screencast", "");
    r.video.forEach((v, i) => {
      lines.push(`${i + 1}. ${v}`);
    });
  }
  if (r.open.length) {
    lines.push("", "## Open", "");
    for (const o of r.open) lines.push(`- ${o}`);
  }
  if (checks) {
    lines.push("", "## Checks", "");
    for (const c of checks) lines.push(`- ${c.ok ? "ok  " : "TODO"} ${c.need}: ${c.detail}`);
  }
  return `${lines.join("\n")}\n`;
}
