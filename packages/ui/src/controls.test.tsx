import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Tag } from "./controls.js";

describe("Button", () => {
  it("is turned off while busy, so Enter can't press it again, and stays solid", () => {
    const html = renderToStaticMarkup(<Button busy>Approve</Button>);
    expect(html).toMatch(/\sdisabled(=""|\s|>)/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled:opacity-100");
  });

  it("is on when not busy and not disabled", () => {
    const html = renderToStaticMarkup(<Button>Approve</Button>);
    expect(html).not.toMatch(/\sdisabled(=""|\s|>)/);
    expect(html).not.toContain("aria-busy");
  });

  it("holds the ring faded out when it can go busy, so the width stays", () => {
    const idle = renderToStaticMarkup(<Button busy={false}>Approve</Button>);
    expect(idle).toContain("data-busy");
    expect(idle).not.toContain("data-on");
    expect(renderToStaticMarkup(<Button busy>Approve</Button>)).toContain("data-on");
  });

  it("has no busy slot when it never goes busy", () => {
    expect(renderToStaticMarkup(<Button>Approve</Button>)).not.toContain("data-busy");
  });

  it("gives a chip the same ring", () => {
    expect(renderToStaticMarkup(<Tag busy>Drafting</Tag>)).toContain("data-on");
    expect(renderToStaticMarkup(<Tag>Drafting</Tag>)).not.toContain("data-busy");
  });
});
