# Engineering Intake Engine v0.1

> **Laboratory MVP.** Preliminary engineering intake only. This tool does not determine final equipment
> selection. Final configuration and compatibility must be confirmed by a qualified Fluidic engineer.

**Resumen (ES).** Prototipo funcional, 100 % local (sin backend, sin APIs, sin base de datos). Una persona describe
una aplicación de *potting / encapsulado* en lenguaje natural; el sistema la convierte en un **Engineering Brief**
estructurado, detecta qué falta, hace **una pregunta a la vez** y prepara un **borrador de RFQ** para revisión de un
ingeniero. Nunca inventa datos ni afirma que una máquina sea la correcta. Instalación: `npm install` y `npm run dev`.

---

## What it does

The hypothesis this MVP tests: *a person can describe an industrial application in plain language, and the system can
turn that into a structured engineering brief, ask the few questions that matter, and prepare a more complete RFQ
draft for human review.*

1. **Describe** – type (or load the demo) a free-text description of a potting / encapsulation application.
2. **Understand** – a local rule-based extractor reads it. The system answers *“Got it. I have identified: …”* and lists
   what it found, each item marked **known**, **inferred**, **needs review** or **unknown**.
3. **Ask** – it asks **one question at a time**, only about what is still missing, in priority order. It never asks for
   something you already told it. Every question can be answered, skipped, or answered with *“I don't know”*.
4. **Brief** – the **Engineering Brief** (right side) updates live, with a completeness indicator, missing-information
   list, engineer-review notes and *preliminary platform context* (only when enough is known).
5. **RFQ draft** – **REQUEST FOR QUOTE — DRAFT** with every unknown shown as *Not provided*. **COPY RFQ** puts it on the
   clipboard; **DOWNLOAD / EXPORT** saves a `.txt` (the RFQ plus the status and source of every field).

What it deliberately does **not** do: replace an engineer, say that a machine is the right one, estimate or default
missing values, assume units, or talk to any service. Final system selection always requires Fluidic engineering review.

Only one application is supported: **Potting & Encapsulation**.

## Quick start

Requirements: Node.js 18 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm test` | Whole test suite (Vitest, runs once) |
| `npm run test:cases` | Only the data-driven cases of `test-cases.json`, verbose |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` (strict) over `src`, `tests` and config |
| `npm run build` / `npm run preview` | Production bundle in `dist/` and a local preview |

Use **LOAD DEMO CASE** in the header to see the complete flow immediately. The description box sends with
**Ctrl/Cmd+Enter**; answers send with **Enter** (Shift+Enter for a new line).

### Try these

| You write | What the system keeps | What stays unknown / is asked next |
| --- | --- | --- |
| `We need to pot 500 electronic modules per hour using a two-component epoxy.` | 2 components, epoxy, 500 parts/hour | ratio (asked next), viscosity, shot size, flow rate, automation |
| `We use a 10:1 epoxy and need 100 cc/min.` | ratio 10:1, flow 100 cc/min; component count **inferred** 2 from the two-term ratio, marked *inferred — unconfirmed* | shot size, production, viscosity; no platform shown (count only inferred) |
| `We need automated dispensing of polyurethane.` | polyurethane, automated | component count (asked next) |
| `We manually dispense silicone into electronic housings.` | silicone, manual, part = electronic housings | component count (asked next) |
| `We need to encapsulate 2,000 parts per week.` | 2000 parts/week, sub-category *Encapsulation* | ratio, shot size |
| `We need a robotic potting system.` | robotic handling = yes; automation level only **inferred** as *Automated* | everything else |
| `We have three components with a 1:1:1 ratio.` | 3 components, ratio 1:1:1 → *Preliminary platform context* lists PK3D | chemistry (asked next), production, viscosity |
| `We don't know the viscosity yet.` | nothing numeric; viscosity recorded as *the user does not know yet* | never asked again; listed in the engineer-review notes |

`test-cases.json` contains these and many more (ranges, bounds, conflicts, negations, decimal commas, out-of-scope
applications, gibberish…).

## The rules the engine follows

These are enforced in code and covered by tests:

- **Value and status are separate.** A numeric field is a real number or `null` — never `"unknown"`, `"high"` or
  `"probably 5000"`. The status is one of `KNOWN`, `UNKNOWN`, `INFERRED`, `REQUIRES_ENGINEER_REVIEW`, plus the origin
  (`USER_STATED`, `NORMALIZED`, `INFERRED`, `NONE`) and the user's own words as evidence (`raw`).
- **Nothing inferred is shown as fact.** Deductions (a component count taken from the number of ratio terms, an
  automation level taken from "robotic") are `INFERRED`, carry a note saying why, earn only half credit in the
  completeness indicator and are marked *(inferred — unconfirmed)* in the RFQ.
- **A guess never overrides something the user stated.** Two different stated values in one message are a
  **conflict**: no value is stored, both candidates are kept, and the engine asks which one applies.
- **Qualitative, ranged and bounded statements are not numbers.** “High viscosity”, “10–20 g”, “up to 600 parts/hour”
  become `REQUIRES_ENGINEER_REVIEW` with value `null`; the user's words are kept and the question is still asked once.
- **“I don't know” is an answer**, not a value. It is remembered, never asked again, and listed for the engineer.
- **Contradictions are not hidden.** A component count that disagrees with the ratio (e.g. *two components* with
  *1:1:1*, or *a single component* with *10:1*) is shown as *needs review*, asked about once, and no platform context
  is shown until it is resolved.
- **Platform context is conservative.** It needs a *stated* component count (and a stated ratio for two components).
  Statements say *“Potentially relevant platform”*, never *“correct”* or *“recommended”*, and always end with
  *“Final system selection requires Fluidic engineering review.”* Not enough information → nothing is shown.
- **The completeness percentage is a visual indicator**, not a technical or scientific measure (the UI says so).

## Architecture

```
free text ─► extraction (local rules) ─► merge ─► derive ─► ApplicationBrief ─┬─► calculateMissingFields() ─► getNextQuestion()
                   ▲                                                          ├─► buildEngineeringBrief()  ─► right panel
          Extractor interface                                                 └─► buildRFQ() ─► RFQ panel / copy / .txt
          (replace with an LLM)
```

```
src/
  models/       Field / ApplicationBrief types and createEmptyBrief()
  data/         fields.ts (field catalogue) · products.ts (platform info + notices) · demo.ts
                applications/  one profile per application (potting.ts) + registry
  extraction/   Extractor interface, local rule-based extractor, one file per rule family (rules/)
  engine/       merge · derive · missing · completeness · review · viewStatus · format · IntakeSession
  questions/    question bank, getNextQuestion(), interpretAnswer() (what did this reply mean?)
  rfq/          buildEngineeringBrief(), buildRFQ(), platform context, TXT export
  ui/           controller + components (plain TypeScript DOM, no framework)
  styles/       CSS split by area (tokens, layout, components, intake, brief, rfq, statusbar)
  utils/        text helpers, clipboard, download
tests/          Vitest suites; test-cases.json (project root) drives tests/cases.test.ts
```

The five functions of the business logic (all re-exported from `src/engine/index.ts`):

| Function | In → Out |
| --- | --- |
| `extractRequirements(text)` | free text → extracted data points (`ExtractedValue[]`: field, value, status, origin, evidence, note) |
| `calculateMissingFields(brief)` | brief → what is missing, most important first, with the reason (not provided / user doesn't know / needs detail / conflict) |
| `getNextQuestion(brief)` | brief → the single most useful next question, or `null` |
| `buildEngineeringBrief(brief)` | brief → everything the Engineering Brief screen shows, as plain data |
| `buildRFQ(brief, options)` | brief → the RFQ draft (`rfqToText()` renders the plain text; `buildExportText()` adds the field-level detail) |

`IntakeSession` wires them into one conversation (transcript, current question, phase). The UI only calls
`submit()`, `skip()`, `markUnknown()`, `finish()`, `reset()` and `setRfqDetail()` and renders what it gets back, so another
front end (or a test) can drive the same engine.

**Question order.** Contradictions first → a unit missing for a value already given → `REQUIRED` fields →
`USEFUL` → `OPTIONAL`, always in the profile's `questionOrder`. Each field is asked at most once (a contradiction that appears later can trigger one more
clarification); a clarification the user skips is flagged for the engineer instead of being repeated.

## How to extend it

### Add or change a question / field

1. Add the id to `FIELD_IDS` (`src/models/types.ts`), the group in `ApplicationBrief` and `createEmptyBrief()`
   (`src/models/brief.ts`), and an entry in `FIELD_DEFS` (`src/data/fields.ts`: label, short label, kind, unit field).
2. Give it a rule in the application profile (below) and, if the engine should ask for it, a template in
   `src/questions/questionBank.ts` and a parser branch in `src/questions/answerParser.ts`.
3. Show it: `src/rfq/engineeringBrief.ts` (brief rows / field table) and `src/rfq/rfq.ts` (RFQ lines).

### Add an application (e.g. gasket dispensing, bonding)

An **application profile** is the only place that knows what matters for one kind of application
(`src/data/applications/types.ts`):

```ts
export const BONDING_PROFILE: ApplicationProfile = {
  id: 'bonding',
  name: 'Bonding',
  scope: { inScope: /\bbond(?:ing)?\b/i, subcategories: [], otherApplication: /\bpott\w*\b/i },
  rules: {
    'material.componentCount': { priority: 'REQUIRED' },
    'production.shotSize': { priority: 'REQUIRED' },
    'mixing.ratio': { priority: 'REQUIRED', applicable: (b) => /* only for 2+ components */ true },
    'production.flowRate': { priority: (b) => /* conditional importance */ 'USEFUL' },
    // ...one rule per field; no rule = not applicable
  },
  questionOrder: ['material.componentCount', 'production.shotSize' /* … */],
};
```

Register it in `src/data/applications/index.ts` (`APPLICATION_PROFILES`) and pass it to `new IntakeSession(profile)` in
`src/main.ts` (today it uses the default profile; add a selector or change `DEFAULT_PROFILE`). Priorities can depend on the brief
(`priority` and `applicable` accept functions), which is how “flow rate is required unless shot size and cycle time are
known” is expressed. Then add cases to `test-cases.json`.

### Add or change products / platform context

Platform facts live in `src/data/products.ts` (`PLATFORMS`: id, name, number of components, ratio range, one-line
public summary). *When* a platform may be mentioned is decided in `src/rfq/platformContext.ts`. Keep the rules: public
information only, wording such as “Potentially relevant platform”, the engineering-review disclaimer always present,
nothing shown when information is insufficient. `getPlatformContext()` is currently specific to the potting
application. Cover changes in `tests/rfq.test.ts` — the “never claims a machine is the right one” test scans all generated text.

### Add or change an extraction rule

Rules are small functions `(scan) => void` in `src/extraction/rules/`, registered in the ordered `RULES` list in
`src/extraction/localExtractor.ts`. A rule *consumes* the text it reads so weaker rules cannot read the same words
twice, which is why order matters (flow rate and shot size run before production rate):

```ts
// 'properties.pressure' is an example: a new field must first be added to FIELD_IDS (see "Add or change a question / field").
export const pressureRule: Rule = (scan) => {
  for (const m of scan.matches(/\b(?<n>\d+(?:\.\d+)?)\s*bar\b/gi)) {
    scan.known('properties.pressure', Number(m.groups?.n), m[0], { note: 'Stated by the user.' });
    scan.consume(m);
  }
};
```

Use `scan.known / knownAs` for what the user wrote, `scan.inferred` for deductions (always with a note),
`scan.review` for qualitative / ranged / hazardous statements (value `null`), `scan.declaredUnknown` for “I don't know”,
and `scan.negatedBefore(index)` to respect “not” / “no” / “without”. Add examples to `tests/extraction.test.ts`.

## Replacing the extractor with an AI

The business logic never calls the rule-based extractor directly: the session uses the *active* extractor, and anything that
implements `Extractor` can replace it (`src/extraction/types.ts`):

```ts
import { setExtractor } from './extraction/index.ts';
import type { Extractor } from './extraction/index.ts';

const llmExtractor: Extractor = {
  name: 'my-llm-extractor',
  async extract({ text, expecting, brief, profile }) {
    const json = await callYourModel(text, { expecting });   // your code: model call + schema validation
    return toExtractionResult(json);                         // { values, signals, capturedNotes }
  },
};

setExtractor(llmExtractor);   // e.g. in src/main.ts, before mountApp()
```

Everything else (merging, derivation, missing fields, questions, brief, RFQ) is unchanged. The contract that keeps the
no-invention guarantees intact:

- every item is `{ fieldId, value, status, origin, raw, note? }`, `fieldId` one of `FIELD_IDS`;
- `KNOWN` only for what the user wrote, with `raw` = their words, copied verbatim; `INFERRED` for anything deduced, with a note;
- ranges, bounds and qualitative statements → `REQUIRES_ENGINEER_REVIEW` with `value: null`; “I don't know” → `userUnknown: true`;
- never put words (“high”, “unknown”) into a numeric field; never convert units silently;
- validate the model's output (schema, known field ids, `raw` actually present in the input) before returning it. The merge layer
  stops guesses overriding stated values and detects conflicts, but it cannot check evidence for you.

`tests/noInvention.test.ts` contains the checks that make sense to run against any extractor's output. Do **not** put an API key in
this browser app: call your own backend or proxy (out of scope for v0.1).

## Tests

`npm test` runs, among others:

- **`test-cases.json`** (40+ cases, run by `tests/cases.test.ts`): each case feeds an `input` to a fresh session and checks only the keys
  it lists under `expect` — `known`, `inferred`, `review`, `unknown`, `userUnknown`, `conflict`, `next` (the single next question),
  `notAsked`, `missing`, `platforms`, `flags`, `rfq.contains` / `rfq.notProvided`, `completeness`… (the `keys` block at the top of
  the file documents them). To add a case, append an object with a new id.
- **`extraction.test.ts`** – component count, chemistry, ratio, production rate, shot size, flow rate, viscosity, automation, units,
  negation, ranges and bounds, decimal commas, thousands separators.
- **`missing.test.ts`**, **`questions.test.ts`** – dynamic priorities; one question at a time, in order, never re-asking, conflicts and
  unit follow-ups, parsing of every kind of answer (and that every offered choice can be clicked).
- **`rfq.test.ts`** – RFQ lines, “Not provided”, inferred markers, platform context rules, Engineering Brief rows and statuses, export.
- **`noInvention.test.ts`** – properties over every case: each known value is traceable to the user's words, nothing inferred is
  shown as fact, no number in the RFQ that the user did not give, no guarantee language, notices always present.
- **`session.test.ts`** – the conversation: first description, answers, skip, “I don't know”, finish, reset, replaceable extractor.

## Limitations

- **English only.** A description in another language extracts nothing, and the tool says so instead of guessing.
- **One application** (Potting & Encapsulation). Text that sounds like another application (bonding, gaskets, foam…) is flagged for
  engineer review rather than silently accepted.
- **Rule-based reading.** It understands common phrasings, not every phrasing. When a rule does not recognise something it extracts
  nothing (a deliberate failure mode); the question flow then asks for it. A bare “300 per hour” with no context is not read as a
  production rate, and a temperature without material or ambient context is not extracted.
- **No unit conversion.** Values keep the unit the user gave; a number without a unit is stored as stated, flagged, and the unit is asked.
- **Platform context** is a coarse summary of public product information in `src/data/products.ts` (component count and ratio only). It is
  not selection logic and says so. Viscosity, flow, chemistry compatibility, abrasive fillers, hazardous areas and everything else
  are left to the engineer.
- **No persistence.** State lives in memory; reloading the page clears it (no backend, database or accounts, by design). Copy or download
  the RFQ to keep it.
- **No integration** with CRM, e-mail, ERP or any Fluidic system, by design.
- **The UI has no automated tests in the repository.** It was exercised in a real browser during development (see below); the
  engine behind it is covered by the suites above.

## Verification status

This project was written and verified in a sandbox whose network allowlist blocks the npm registry, so **`npm install`,
`npm run dev` and Vitest itself could not be run there**. What was run instead:

- the strict TypeScript compile (`tsc`, same options as `tsconfig.json`) over `src`, `tests` and `vite.config.ts` — clean (with a local
  type stub standing in for the `vitest` package, which could not be installed);
- the complete test suite under Bun's Vitest-compatible runner (`bun test`) — all passing;
- the application bundled and loaded in headless Chromium, driving the real UI: describe → questions → brief → RFQ → copy / download →
  new intake, plus the contradiction, “approximately” and skipped-conflict paths, with no console errors; layout checked at 1920, 1440,
  1024 and 390 px width.

Please run `npm install && npm run typecheck && npm test && npm run dev` once on your machine; if anything differs, that is a bug to report.
