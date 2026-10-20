import { describe, expect, it } from "vitest";
import { TransportRefused } from "../send/transport.js";
import { InstantlyTransport } from "./instantly.js";

const inbox = "sender@example.com";

describe("InstantlyTransport", () => {
  it("refuses every send at the sender level", async () => {
    const err = await new InstantlyTransport().send({ fromAddress: inbox }).catch((e) => e);
    expect(err).toBeInstanceOf(TransportRefused);
    expect(err.senderLevel).toBe(true);
  });
});
