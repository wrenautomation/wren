/**
 * autobrowse's machine, from here: start it when a `sites` call needs it.
 * The box stops itself when idle (autobrowse IDLE_STOP_MINUTES) and its
 * `autobrowse:started-by` tag says who booted it; ours is `wren`, which
 * both its idle stop and a deploy's release are free to end.
 */
import type { EC2Client } from "@aws-sdk/client-ec2";
import { DESK, SITES, type SitesHost, type Wake } from "./restate.js";

const STARTED_BY_TAG = "autobrowse:started-by";

// 2.3 MB SDK: loaded on the first wake, not at Lambda init
let sdk: Promise<typeof import("@aws-sdk/client-ec2")> | undefined;
function ec2() {
  sdk ??= import("@aws-sdk/client-ec2");
  return sdk;
}

/**
 * Where wren's `sites` calls go: the box when its instance id is set, else the Mac's
 * desk worker. No box id, no box: every caller follows this one switch.
 */
export function sitesHost(instanceId: string | undefined): SitesHost {
  return instanceId ? { service: SITES, wake: ec2Wake(instanceId) } : { service: DESK };
}

export interface BoxPort {
  state(id: string): Promise<string>;
  start(id: string, startedBy: string): Promise<void>;
}

/** No client: one is made on first use, in `region` or the default. */
export function boxPort(given?: EC2Client, region?: string): BoxPort {
  let made: EC2Client | undefined;
  const client = async (): Promise<EC2Client> => {
    if (given) return given;
    made ??= new (await ec2()).EC2Client(region ? { region } : {});
    return made;
  };
  return {
    async state(id) {
      const { DescribeInstancesCommand } = await ec2();
      const out = await (await client()).send(new DescribeInstancesCommand({ InstanceIds: [id] }));
      return out.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? "unknown";
    },
    async start(id, startedBy) {
      const { CreateTagsCommand, StartInstancesCommand } = await ec2();
      const c = await client();
      await c.send(
        new CreateTagsCommand({
          Resources: [id],
          Tags: [{ Key: STARTED_BY_TAG, Value: startedBy }],
        }),
      );
      await c.send(new StartInstancesCommand({ InstanceIds: [id] }));
    },
  };
}

/** Start the box unless it is already up or on its way (a `stopping` one is started once it has stopped: EC2 refuses earlier). */
export function wakeBox(box: BoxPort, id: string, startedBy = "wren"): Wake {
  return async () => {
    const state = await box.state(id);
    if (state === "running" || state === "pending") return "running";
    if (state === "stopping") throw new Error(`autobrowse box ${id} is still stopping`);
    await box.start(id, startedBy);
    return "started";
  };
}

export function ec2Wake(id: string, region?: string): Wake {
  return wakeBox(boxPort(undefined, region), id);
}
