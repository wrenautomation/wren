# Guides

A guide is a tip under test. Scope: one subject (`--subject`), one kind (`--kind`), or all.

```sh
./bin/wren variants guide add "…" [--subject s | --kind k] [--source study|sop|skill|agent --ref …]
./bin/wren variants guide lock|drop|test <id>
```

- Tag each sample's `guides` with the guide ids it applies. That is how a guide's with-vs-without good rate is counted.
- `effect`: good rate with vs without; `early` while under 30 judged.
- Not `early` and `diff` clearly positive: propose to lock it. Clearly negative: propose to drop it. He decides.
- A locked guide is a rule: apply it to every sample of its scope, and say which SOP it belongs in.
