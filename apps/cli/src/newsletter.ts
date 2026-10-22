/**
 * `wren newsletter …` (designs/2026-10-11-newsletter.md): a blog post mailed to everyone confirmed
 * on its topic. `send` reads the post from the lander (/blog/<slug>.json), shows who would get it,
 * and with `--yes` hands it to the `Newsletter` object, which sends each one once.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { issueTag, listmonk } from "@wren/channel-email/listmonk";
import type { Newsletter } from "@wren/channel-email/restate";
import { ingressOf, type Settings } from "@wren/config";
import { issueAudience, issueSends, mayMarket, saveTopic } from "@wren/core/marketing";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const TOPIC = "newsletter";

interface Post {
  slug: string;
  title: string;
  url: string;
  text: string;
  draft: boolean;
}

async function postOf(site: string, slug: string): Promise<Post> {
  const res = await fetch(`${site.replace(/\/+$/, "")}/blog/${encodeURIComponent(slug)}.json`);
  if (!res.ok) throw new Error(`no post ${slug} on ${site} (HTTP ${res.status}); is it pushed?`);
  return (await res.json()) as Post;
}

export function registerNewsletter(program: Command, withMainDb: WithDb, settings: Settings) {
  const cmd = program
    .command("newsletter")
    .description("blog posts by email to the people who signed up for them");

  cmd
    .command("topic")
    .description("Make or reword the list the blog's signup names")
    .option("--name <name>", "the list's name", TOPIC)
    .option("--public-name <words>", "what the preference center calls it", "New posts")
    .option("--line <words>", "its one line", "One email when a new post goes up on the blog.")
    .option("--cadence <words>", "how often, in words", "When I post")
    .action(async (o: { name: string; publicName: string; line: string; cadence: string }) => {
      const t = await withMainDb((db) =>
        saveTopic(db, {
          name: o.name,
          channel: "email",
          publicName: o.publicName,
          line: o.line,
          cadence: o.cadence,
          public: true,
        }),
      );
      console.log(`${t.name}: "${t.publicName}", ${t.cadence}. Signups on the blog land here.`);
    });

  cmd
    .command("send <slug>")
    .description("Mail a post to its list: shows who gets it; --yes sends")
    .option("--topic <name>", "which list", TOPIC)
    .option("--test <address>", "only this address (our own domain), marked [test]")
    .option("--site <url>", "where the post is", settings.siteBaseUrl)
    .option("--yes", "send it")
    .action(
      async (slug: string, o: { topic: string; test?: string; site: string; yes?: boolean }) => {
        const post = await postOf(o.site, slug);
        if (post.draft) throw new Error(`${slug} is a draft`);
        const key = `${o.topic}:${post.slug}`;
        const issue = {
          topic: o.topic,
          slug: post.slug,
          subject: post.title,
          text: post.text,
          url: post.url,
          ...(o.test ? { test: o.test } : {}),
        };
        const go = () =>
          clients
            .connect(ingressOf(settings))
            .objectSendClient<Newsletter>({ name: "Newsletter" }, key)
            .send(issue);
        if (o.test) {
          await go();
          return console.log(`Test of "${post.title}" on its way to ${o.test}.`);
        }
        const why = await withMainDb(async (db) => {
          const tally: Record<string, number> = {};
          for (const c of await issueAudience(db, o.topic)) {
            const v = await mayMarket(db, { channel: "email", address: c.address, topic: o.topic });
            const k = v.send ? "gets it" : v.why;
            tally[k] = (tally[k] ?? 0) + 1;
          }
          return { tally, sent: await issueSends(db, key) };
        });
        const line = Object.entries(why.tally)
          .map(([k, n]) => `${n} ${k}`)
          .join(", ");
        console.log(`"${post.title}" (${post.url})`);
        console.log(`${o.topic}: ${line || "nobody confirmed yet"}; already sent ${why.sent}.`);
        if (!o.yes) return console.log("Add --yes to send. Each address gets it once.");
        await go();
        console.log(`Sending as Newsletter/${key}. \`wren newsletter status ${slug}\` counts it.`);
      },
    );

  cmd
    .command("status <slug>")
    .description("How many got a post")
    .option("--topic <name>", "which list", TOPIC)
    .action(async (slug: string, o: { topic: string }) => {
      const key = `${o.topic}:${slug}`;
      const [sent, all] = await withMainDb((db) =>
        Promise.all([issueSends(db, key), issueAudience(db, o.topic)]),
      );
      console.log(`${key}: sent to ${sent} of ${all.length} confirmed.`);
      // With Listmonk, the issue is a campaign there: its state says whether it is still going out.
      const { listmonkUrl: url, listmonkUser: user, listmonkToken: token } = settings;
      if (!url || !user || !token) return;
      const tag = issueTag(o.topic, slug);
      const found = (await listmonk({ url, user, token }).campaigns(tag)).find((c) =>
        c.tags?.includes(tag),
      );
      if (found)
        console.log(
          `Listmonk campaign #${found.id}: ${found.status}, ${found.sent ?? 0} of ${found.to_send ?? 0} posted.`,
        );
    });
}
