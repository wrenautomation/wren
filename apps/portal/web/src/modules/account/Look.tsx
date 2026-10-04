/** A workspace's look: Account's Look page for its owners, a client's record for Wren's team. */
import { Alert, Loading, LookEditor, PageHeader } from "@wren/ui";
import { call, ME_CHANGED, type Me } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { QUIET } from "../work/bits.js";
import { usePeople } from "./load.js";

/** The editor on `client`'s stored look; `setLook` says who may save it. */
export function ClientLook({ client }: { client: string }) {
  const me = useCall(`look:${client}`, () => call<Me>("delivery/me"));
  if (me.error && !me.data) return <Alert onRetry={me.retry}>{me.error.message}</Alert>;
  if (!me.data) return <Loading lines={4} />;
  return (
    <LookEditor
      key={client}
      look={me.data.clients.find((c) => c.id === client)?.look ?? null}
      onSave={async (look) => {
        await call("console/setLook", { client, look });
        dispatchEvent(new Event(ME_CHANGED));
      }}
    />
  );
}

export function Look(props: PageProps) {
  const people = usePeople(props, 0);
  return (
    <>
      <PageHeader
        title="Look"
        lede="Your workspace's colors. Pick a preset, or start from your brand color or logo."
      />
      {people.error && !people.data ? (
        <Alert onRetry={people.retry}>{people.error.message}</Alert>
      ) : !people.data ? (
        <Loading lines={4} />
      ) : people.data.canManage ? (
        <ClientLook client={props.client} />
      ) : (
        <p className={QUIET}>Only an owner of the account can change its look.</p>
      )}
    </>
  );
}
