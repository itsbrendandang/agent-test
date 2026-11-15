# Example library

These are scripted Demo pipeline outputs, not research or benchmark results. No AI model or live search was used. All cost $0.

`manifest.json` lists four finished research answers, one cancelled answer and the bundled KRAS G12C board review. The Demo writer uses fixed text: the GLP-1 question illustrates the Quick workflow, not a real answer about that market. The Standard answers show hypotheses and method specialists.

Regenerate from the repository root:

```sh
NO_PAID_CALLS=1 PAID_SWITCH_LOCKED=1 node scripts/generate-examples.mjs
```

The script starts its own locked, scripted engine on port 8812 (`EXAMPLES_PORT` overrides it), using separate folders under the home directory. It copies only records, events and result files, not durable sessions. To capture cancellation reliably, the research engine's existing interruption hook pauses after a stored step, then its normal cancel route stops that answer. No events are written by the generator. A successful generation removes superseded fixture folders. Staging folders are left for inspection.

The API adds example/read-only provenance to responses without changing the stored event history. Examples are never copied into writable run stores, counted as spending or resumed on startup. `GLHF_HIDE_EXAMPLES=1` hides their listings and reads. Mutations remain refused even when hidden. Opening an example does not start a run.
