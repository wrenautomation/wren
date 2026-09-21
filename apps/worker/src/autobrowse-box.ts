/**
 * autobrowse's machine, from here: start it when a `sites` call needs it.
 * The box stops itself when idle (autobrowse IDLE_STOP_MINUTES) and its
 * `autobrowse:started-by` tag says who booted it; ours is `wren`, which
 * both its idle stop and a deploy's release are free to end.
 */
import {
  CreateTagsCommand,
  DescribeInstancesCommand,
  EC2Client,
  StartInstancesCommand,
} from "@aws-sdk/client-ec2";
import type { Wake } from "@wren/core/content/restate";

export const STARTED_BY_TAG = "autobrowse:started-by";

export interface BoxPort {
  state(id: string): Promise<string>;
  start(id: string, startedBy: string): Promise<void>;
}

export function boxPort(client: EC2Client): BoxPort {
  return {
    async state(id) {
      const out = await client.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
      return out.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? "unknown";
    },
    async start(id, startedBy) {
      await client.send(
        new CreateTagsCommand({
          Resources: [id],
          Tags: [{ Key: STARTED_BY_TAG, Value: startedBy }],
        }),
      );
      await client.send(new StartInstancesCommand({ InstanceIds: [id] }));
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
  return wakeBox(boxPort(new EC2Client(region ? { region } : {})), id);
}
