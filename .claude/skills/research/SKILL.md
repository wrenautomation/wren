---
name: research
description: Research a question or a vertical from the open web into a cited report with `wren study`. Use when the user says "research <topic>", "look into <vertical>", "should we sell to <who>", "find offers/angles/benchmarks for <niche>", "write cold emails for <vertical> from research", or asks for a sourced answer. Every claim cites a quote on a page we read; drafts (offers, emails) cite claims.
---

# research

Run the CLI as `./bin/wren` from the repo root. Studies live in the main database.

## The loop

```sh
./bin/wren study new <slug> --question "…" [--angle "…"]...          # a plain question
./bin/wren study new <slug> --vertical "<who>" --sells "<what>" [--rules <file>] [--niche <n>]
./bin/wren study run <slug> [--ask] [--llm <spec>] [--redo <step>]
./bin/wren study report <slug> [--out <file>]
./bin/wren study list
```

- **Slug**: lowercase words and dashes. Reusing a slug with a different question is refused.
- **Angles**: 2 to 5 sub-questions, each answerable from public pages. The question alone is one angle.
- **`--vertical`** fills five angles (owner pains, benchmarks, how they win clients, their buying calendar, competitors and complaints) and two drafts: 5 offers and 3 first-touch emails. `--rules` replaces the default email rules.
- **`study run`** does what is left: plan queries, search, read, pull claims, draft. Ctrl-C and run again to resume. A cap prints when to retry.
- **`--ask`** also asks Perplexity per angle and reads its sources. It caps at 100 a day, so use it for thin angles only.
- **`--redo <step>`** throws away that step and later ones. `--redo claims --llm <stronger model>` rewrites claims and drafts from pages already read, with no new fetching.

## Models

- The default is `WREN_LLM` (Cohere): a reasonable first pass, not the final word.
- The strong path is `--llm claude-code:opus` (or `:sonnet`). It runs `claude -p` on the Claude Code login: no key, no per-call bill, ~2s per call to start. Right for a study's ~12 calls.
- `--llm anthropic:<model-id>` needs `WREN_ANTHROPIC_API_KEY` (none is set today). `--llm <provider>:<model>` works for groq, gemini, openrouter, cohere, mistral and cerebras.
- Say which model and roughly how many calls before a run: 5 plans, 5 claims and 2 drafts per vertical study.

## You are the interface

1. Pick the recipe and angles from what the user asked. Show the angles before the run.
2. Run it, then read the report.
3. Judge it:
   - Thin angles (under three claims) get a narrower `--angle` in a new study, or `--ask`.
   - Weak drafts get a stronger model with `--redo draft`.
4. You may write the final offers or emails yourself from the report's numbered claims:
   - Cite `[n]` for each fact.
   - Never state a number that isn't in a cited claim.
   - Keep the claim's source in the Sources list.
5. Save anything worth keeping under `designs/studies/<date>-<slug>.md`.
   - The repo is public: no client names, no private data.

## One firm

```sh
./bin/wren dossier show <id|domain|name>            # everything we know, with sources
./bin/wren dossier export --niche <n> [--limit n] [--out file.jsonl]
```

Read only: it shows what the runners wrote (findings, enrichments, checks, emails). Use it before writing to one lead.

## Rules

- Claims drop when their quote isn't on the page, or when a number in the claim isn't in the quote. A dropped claim is not a finding.
- Pages are kept as documents. Re-running never re-fetches a page already read.
- Never put a price in an email or on a page.
