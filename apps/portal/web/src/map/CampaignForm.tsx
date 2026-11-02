/**
 * A campaign's own fields as a form (designs/2026-11-02-campaigns.md, phase 5). Save makes a draft
 * with one `set` on the group's `campaign`, then opens it for review: a campaign edit is a version.
 * An empty field is unset, so it inherits. A refusal or a check warning shows as the server says
 * it, and the draft it made is dropped.
 */
import type { MetroBody } from "@wren/pipeline/metro";
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
  type Campaign,
} from "@wren/pipeline/metro-campaigns";
import {
  Alert,
  Button,
  ChecksField,
  DateField,
  FormKept,
  SelectField,
  TextField,
  useEditForm,
  useFieldArray,
} from "@wren/ui";
import { call } from "../api.js";
import { type CampaignValues, ctaStations, fieldsOf, valuesOf } from "./campaign-fields.js";

const CHANNELS = CAMPAIGN_CHANNELS.map((c) => [c, c] as const);
const ROW = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2";
const SUB = "text-[13px] font-medium text-(--ui-ink-2)";

export function CampaignForm({
  metro,
  campaign,
  at,
  onDraft,
  onCancel,
}: {
  metro: MetroBody;
  campaign: Campaign;
  /** The workspace as a call's params. */
  at: Record<string, string>;
  /** The draft was made: open it for review. */
  onDraft: (id: string) => void;
  onCancel: () => void;
}) {
  const id = campaign.id;
  const form = useEditForm<CampaignValues>({
    key: `map:campaign:${at.client ?? ""}:${id}`,
    defaults: valuesOf(campaign.own),
  });
  const ctas = useFieldArray({ control: form.control, name: "ctas" });
  const accounts = useFieldArray({ control: form.control, name: "accounts" });
  const caps = useFieldArray({ control: form.control, name: "caps" });

  const up = campaign.parent ? metro.groups.find((g) => g.id === campaign.parent) : undefined;
  const inherit = up ? `Inherit from ${up.label}` : "Not set";
  const offers = [
    ...new Set([
      ...metro.lines.flatMap((l) => (l.offer ? [l.offer] : [])),
      ...(campaign.own.offer ? [campaign.own.offer] : []),
    ]),
  ];
  const stations = ctaStations(metro, id);
  const outs = metro.lines.filter((l) => l.tier === "out");

  const send = form.onSend(
    async (v) => {
      const name = `${campaign.label} campaign ${new Date().toISOString().slice(0, 19)}`;
      const draft = await call<{ id: string }>("pipeline/shapeDraftNew", { ...at, name });
      const drop = () =>
        call("pipeline/shapeDraftDrop", {
          ...at,
          id: draft.id,
          reason: "The campaign edit was refused.",
        }).catch(() => undefined);
      let warnings: string[];
      try {
        ({ warnings } = await call<{ warnings: string[] }>("pipeline/shapeDraftEdit", {
          ...at,
          id: draft.id,
          ops: [{ op: "set", on: "group", id, field: "campaign", value: fieldsOf(v) }],
        }));
      } catch (e) {
        await drop();
        throw e;
      }
      // The base passed the checks, so a warning is this edit's: say it here, not in a draft.
      if (warnings.length) {
        await drop();
        throw new Error(warnings.join(" "));
      }
      onDraft(draft.id);
    },
    { clear: true },
  );

  return (
    <form
      aria-label={`Edit campaign ${campaign.label}`}
      className="grid gap-3 rounded-(--ui-radius) bg-(--ui-wash) p-3"
      onSubmit={(e) => void send(e)}
    >
      <SelectField
        form={form}
        name="status"
        label="Status"
        options={[["", inherit], ...CAMPAIGN_STATUSES.map((s) => [s, s] as const)]}
      />
      <div className="grid grid-cols-2 gap-2">
        <DateField form={form} name="from" label="From" />
        <DateField form={form} name="until" label="Until" />
      </div>
      <SelectField
        form={form}
        name="offer"
        label="Offer"
        hint="The offer its CTAs sell."
        options={[["", inherit], ...offers.map((o) => [o, o] as const)]}
      />
      <TextField
        form={form}
        name="segment"
        label="Segment"
        hint="A stored segment's number."
        inputMode="numeric"
      />
      {outs.length ? (
        <ChecksField
          form={form}
          name="lines"
          label="Source lines"
          options={outs.map((l) => [l.id, l.label] as const)}
        />
      ) : null}

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className={SUB}>CTA ladder, in order</legend>
        {ctas.fields.map((f, i) => (
          <div key={f.id} className={ROW}>
            <TextField form={form} name={`ctas.${i}.label`} aria-label={`CTA ${i + 1} label`} />
            <SelectField
              form={form}
              name={`ctas.${i}.station`}
              aria-label={`CTA ${i + 1} station`}
              options={[
                ["", "Pick a station"],
                ...stations.map((s) => [s.id, s.label] as const),
                // One set before its station lost its CTA action: kept, so the server says why.
                ...(f.station && !stations.some((s) => s.id === f.station)
                  ? [[f.station, f.station] as const]
                  : []),
              ]}
            />
            <Button tone="quiet" size="dense" icon="close" onClick={() => ctas.remove(i)}>
              Remove
            </Button>
          </div>
        ))}
        <Button
          tone="quiet"
          size="dense"
          icon="plus"
          disabled={!stations.length}
          onClick={() => ctas.append({ label: "", station: "" })}
        >
          {stations.length ? "Add a CTA" : "No CTA station in this campaign"}
        </Button>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className={SUB}>Accounts</legend>
        {accounts.fields.map((f, i) => (
          <div key={f.id} className={ROW}>
            <SelectField
              form={form}
              name={`accounts.${i}.channel`}
              aria-label={`Account ${i + 1} channel`}
              options={[["", "Channel"], ...CHANNELS]}
            />
            <TextField
              form={form}
              name={`accounts.${i}.account`}
              aria-label={`Account ${i + 1}`}
              placeholder="Account id"
            />
            <Button tone="quiet" size="dense" icon="close" onClick={() => accounts.remove(i)}>
              Remove
            </Button>
          </div>
        ))}
        <Button
          tone="quiet"
          size="dense"
          icon="plus"
          onClick={() => accounts.append({ channel: "", account: "" })}
        >
          Add an account
        </Button>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className={SUB}>Day caps</legend>
        {caps.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_5rem_auto] items-end gap-2">
            <SelectField
              form={form}
              name={`caps.${i}.channel`}
              aria-label={`Cap ${i + 1} channel`}
              options={[["", "Channel"], ...CHANNELS]}
            />
            <TextField
              form={form}
              name={`caps.${i}.act`}
              aria-label={`Cap ${i + 1} act`}
              placeholder="Act, like comment"
            />
            <TextField
              form={form}
              name={`caps.${i}.n`}
              aria-label={`Cap ${i + 1} a day`}
              type="number"
              min={0}
              step={1}
            />
            <Button tone="quiet" size="dense" icon="close" onClick={() => caps.remove(i)}>
              Remove
            </Button>
          </div>
        ))}
        <Button
          tone="quiet"
          size="dense"
          icon="plus"
          onClick={() => caps.append({ channel: "", act: "", n: "" })}
        >
          Add a cap
        </Button>
      </fieldset>

      <FormKept form={form} />
      {form.error ? <Alert className="mb-0">{form.error}</Alert> : null}
      <div className="flex gap-2">
        <Button tone="primary" size="dense" type="submit" busy={form.formState.isSubmitting}>
          Save as a draft
        </Button>
        <Button tone="quiet" size="dense" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
