import { describe, expect, it } from "vitest";
import { routeKind, routeTable } from "./routes.js";

describe("routeKind", () => {
  it("every GET is a read", () => {
    expect(routeKind("x", "GET", "/2/tweets/1")).toBe("read");
    expect(routeKind("tiktok", "GET", "/web/me")).toBe("read");
  });

  it("a POST that only reads is a read", () => {
    for (const path of [
      "/v2/post/publish/creator_info/query/",
      "/v2/post/publish/status/fetch/",
      "/v2/video/list/",
      "/v2/video/query/",
    ])
      expect(routeKind("tiktok", "POST", path)).toBe("read");
    expect(routeKind("perplexity", "POST", "/chat/completions")).toBe("read");
  });

  it("a container and an upload are staging; the publish after them is a send", () => {
    expect(routeKind("threads", "POST", "/me/threads")).toBe("staging");
    expect(routeKind("threads", "POST", "/90001/threads")).toBe("staging");
    expect(routeKind("threads", "POST", "/me/threads_publish")).toBe("send");
    expect(routeKind("meta", "POST", "/17841400000/media")).toBe("staging");
    expect(routeKind("meta", "POST", "/17841400000/media_publish")).toBe("send");
    expect(routeKind("x", "POST", "/2/media/upload")).toBe("staging");
    expect(routeKind("x", "POST", "/2/media/upload/77/append")).toBe("staging");
    expect(routeKind("x", "POST", "/2/tweets")).toBe("send");
    expect(routeKind("linkedin", "POST", "/upload")).toBe("staging");
    expect(routeKind("linkedin", "POST", "/rest/posts")).toBe("send");
    expect(routeKind("youtube", "POST", "/upload/youtube/v3/thumbnails/set")).toBe("staging");
  });

  it("a YouTube upload that publishes or adds a track is a send", () => {
    expect(routeKind("youtube", "POST", "/upload/youtube/v3/videos")).toBe("send");
    expect(routeKind("youtube", "POST", "/upload/youtube/v3/videos?part=snippet")).toBe("send");
    expect(routeKind("youtube", "POST", "/upload/youtube/v3/captions")).toBe("send");
  });

  it("a query does not change the route", () => {
    expect(routeKind("meta", "POST", "/17841400000/media?access_token=x")).toBe("staging");
  });

  it("any other write, and any unknown site, is a send", () => {
    expect(routeKind("tiktok", "POST", "/v2/post/publish/video/init/")).toBe("send");
    expect(routeKind("reddit", "POST", "/api/submit")).toBe("send");
    expect(routeKind("brand_new", "POST", "/media")).toBe("send");
    // A row is for its own site only.
    expect(routeKind("x", "POST", "/me/threads")).toBe("send");
    expect(routeKind("youtube", "PUT", "/youtube/v3/videos")).toBe("send");
  });

  it("every row of the table says why", () => {
    for (const r of routeTable()) expect(r.why.length).toBeGreaterThan(5);
  });
});
