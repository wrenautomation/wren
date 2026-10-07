/**
 * A firm's dossier on its page: what the sheet holds on it, each fact with its source and day,
 * its newest posts, and its people. Read only. A client sees it once Company dossier is installed;
 * until then the section points to the Shop.
 */
import { Alert, Empty, Loading } from "@wren/ui";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import { dayLabel, LIST, QUIET, SPLIT } from "../work/bits.js";

/** `@wren/research/dossier`'s `DossierBrief`, as `email/dossier` answers it. */
interface BriefFact {
  what: string;
  text: string;
  source: string | null;
  via: string;
  seen: string;
}
interface DossierBrief {
  facts: BriefFact[];
  posts: {
    site: string;
    kind: string;
    text: string;
    url: string | null;
    published: string | null;
  }[];
  people: { name: string; title: string | null; origin: string; facts: BriefFact[] }[];
}

const PART = "research.dossier";

function FactLine({ f }: { f: BriefFact }) {
  return (
    <li className="grid gap-1">
      <span className={SPLIT}>
        <span className="min-w-0 break-words">
          <b className="font-medium capitalize">{f.what}</b> {f.text}
        </span>
        <span className={`${QUIET} shrink-0 text-[13.5px]`}>{dayLabel(f.seen)}</span>
      </span>
      <span className={`${QUIET} text-[13.5px]`}>
        {f.via}
        {f.source ? (
          <>
            {" · "}
            <a href={f.source} target="_blank" rel="noreferrer">
              Source
            </a>
          </>
        ) : null}
      </span>
    </li>
  );
}

export function FirmDossier({ client, id }: { client: string; id: string }) {
  const got = useCall(`dossier:${client}:${id}`, () =>
    call<DossierBrief>("email/dossier", { client, id: Number(id) }),
  );
  if (got.error && !got.data) {
    if (
      got.error instanceof ApiError &&
      got.error.status === 404 &&
      /not installed/.test(got.error.message)
    )
      return (
        <p className={QUIET}>
          Company dossier isn't installed.{" "}
          <a href={`/marketplace/catalog/${PART}?client=${encodeURIComponent(client)}`}>
            See it in the Shop
          </a>
          .
        </p>
      );
    return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
  }
  if (!got.data) return <Loading lines={3} />;
  const d = got.data;
  if (!d.facts.length && !d.posts.length && !d.people.length)
    return <Empty>Nothing on this company yet. Facts show here as the sheet reads them.</Empty>;
  return (
    <div className="grid gap-6">
      {d.facts.length ? (
        <ul className={LIST}>
          {d.facts.map((f) => (
            <FactLine key={`${f.what}:${f.seen}:${f.text}`} f={f} />
          ))}
        </ul>
      ) : null}
      {d.posts.length ? (
        <div className="grid gap-2">
          <h3 className="text-[13.5px] font-medium">Recent posts</h3>
          <ul className={LIST}>
            {d.posts.map((p) => (
              <li key={`${p.site}:${p.url ?? p.text}`} className="grid gap-1">
                <span className="break-words">{p.text || "No text"}</span>
                <span className={`${QUIET} text-[13.5px]`}>
                  {p.site} {p.kind}
                  {p.published ? ` · ${dayLabel(p.published)}` : ""}
                  {p.url ? (
                    <>
                      {" · "}
                      <a href={p.url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.people.map((p) => (
        <div key={`${p.name}:${p.origin}`} className="grid gap-2">
          <h3 className="text-[13.5px] font-medium">
            {p.name}
            {p.title ? <span className={QUIET}>, {p.title}</span> : null}
          </h3>
          {p.facts.length ? (
            <ul className={LIST}>
              {p.facts.map((f) => (
                <FactLine key={`${f.what}:${f.seen}:${f.text}`} f={f} />
              ))}
            </ul>
          ) : (
            <p className={QUIET}>No facts on them yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}
