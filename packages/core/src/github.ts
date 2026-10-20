/**
 * GitHub's contents API on one repo, with a token for that repo: read a file, write one as a
 * commit, and name the last commit that touched a path. The blog (the lander repo) and the shape
 * mirror (the private sops repo) share it.
 */

/** One repo, as far as Wren needs it. */
export interface GithubFiles {
  read(path: string): Promise<{ text: string; sha: string } | null>;
  /** Commits `text` at `path`; answers the commit's sha. Unchanged text commits nothing (null). */
  write(path: string, text: string, message: string): Promise<string | null>;
  /** The newest commit that touched `path` on the branch; null when none did. */
  lastCommit(path: string): Promise<string | null>;
}

/**
 * The contents API on `repo` ("owner/name"), main branch unless `branch` says, with a token for
 * that repo. `api` is GitHub's by default; a self-hosted Forgejo or Gitea answers the same
 * contents and commits calls at `https://<host>/api/v1`, so one setting moves the repo there.
 */
export function githubRepo(o: {
  token: string;
  repo: string;
  branch?: string;
  api?: string;
  fetch?: typeof fetch;
}): GithubFiles {
  const f = o.fetch ?? fetch;
  const branch = o.branch ?? "main";
  const api = `${(o.api ?? "https://api.github.com").replace(/\/+$/, "")}/repos/${o.repo}`;
  const at = (path: string) =>
    `${api}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const headers = {
    authorization: `Bearer ${o.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "wren",
  };
  const fail = async (res: Response, what: string) => {
    const why = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    return new Error(`github ${what}: HTTP ${res.status}${why ? ` (${why})` : ""}`);
  };
  async function read(path: string) {
    const res = await f(`${at(path)}?ref=${encodeURIComponent(branch)}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw await fail(res, `read ${path}`);
    const b = (await res.json()) as { content?: string; sha: string };
    return { text: Buffer.from(b.content ?? "", "base64").toString("utf8"), sha: b.sha };
  }
  return {
    read,
    async write(path, text, message) {
      const now = await read(path);
      // A retry after a commit that landed finds its own text: nothing to do.
      if (now?.text === text) return null;
      const res = await f(at(path), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          message,
          branch,
          content: Buffer.from(text, "utf8").toString("base64"),
          ...(now ? { sha: now.sha } : {}),
        }),
      });
      if (!res.ok) throw await fail(res, `write ${path}`);
      return ((await res.json()) as { commit?: { sha?: string } }).commit?.sha ?? null;
    },
    async lastCommit(path) {
      const res = await f(
        `${api}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=1`,
        { headers },
      );
      if (!res.ok) throw await fail(res, `commits of ${path}`);
      return ((await res.json()) as Array<{ sha?: string }>)[0]?.sha ?? null;
    },
  };
}
