# FutureMap AI -- MVP (Education & Career Pathway Explorer)

Working prototype, evolved from the original "job-finder" MVP into a connected
education + career pathway graph. Zero npm dependencies -- runs with plain
Node.js, no install step, no internet needed (LLM narration is optional and
off by default).

## Run it

```
node server.js
```

Then open `http://localhost:3000`.

## What's implemented

### Original (preserved, unchanged behaviour)
- **Profile builder** (`public/index.html`, `public/app.js`) -- age, subjects, interests, skills, goals as tap-to-select chips.
- **Scoring engine** (`lib/scoring.js`) -- rules-based, NOT an LLM. Computes interest/skill/goal fit per career, applies a subject hard-gate check, and selects the top 5 maximising both fit AND category diversity.
- **Narrative layer** (`lib/narrative.js`) -- turns scored output into plain-language rationale + roadmap. Template-based by default; never invents a number.
- **Career Simulator "what if"** (`/api/simulate`).
- **Life Simulator** (`lib/lifeSimulator.js`, `lib/lifeNarrative.js`, `/api/simulate-life`).

### New: Pathways graph (this round of changes)
The product no longer stops at "student -> job." `lib/pathways.js` connects:

```
Subject -> Qualification -> Course -> University -> Career -> Specialisation
```

- **`data/subjects.json`** -- GCSE/A-Level/BTEC/T-Level/IB subjects, each linked to the courses it unlocks.
- **`data/qualifications.json`** -- the qualification ladder (GCSE -> A-Level/BTEC/T-Level -> Degree/Apprenticeship -> Masters/PhD), so routes other than "A-Level then university" (apprenticeships, degree apprenticeships, foundation years, gap years) are first-class.
- **`data/courses.json`** -- 11 degree courses (Computer Science, Psychology, Medicine, Business, Economics, History, Engineering, Design, Law, Architecture, Nursing) with what you learn, skills gained, typical modules, required subjects, demand/difficulty, and the careers each one leads to.
- **`data/universities.json`** -- sample UK universities with per-course UCAS points, typical grades, tuition fees, duration, placement/foundation year availability, and employability rate, so courses can be compared across providers.
- **`data/careers.json`** -- existing 20 careers, now each linked to `subjectIds` and `courseIds` so they plug into the graph instead of standing alone.

New API routes:
- `GET /api/subjects`, `GET /api/subjects/:id/explore` -- subject -> courses -> careers fan-out.
- `GET /api/courses`, `GET /api/courses/:id/explore` -- course detail: required subjects, careers, alternative courses, offering universities.
- `GET /api/universities`, `GET /api/universities-for-course?courseId=...`
- `GET /api/qualifications` -- the qualification ladder.
- `GET /api/compare?type=course|career|university&ids=a,b,c` -- generic side-by-side comparison.

New frontend tabs (`public/index.html` / `public/app.js`), alongside the original planner:
- **Explore Subjects** -- pick a subject, see the courses and careers it unlocks.
- **Explore Courses** -- browse the 11 courses directly (course-first, not job-first), see modules, required subjects, careers, and ranked universities.
- **Compare** -- pick 2+ courses, careers, or universities and see a side-by-side table.

The roadmap generated for each top-5 career path is now built from this graph
(`buildConnectedRoadmap` in `lib/pathways.js`) instead of a flat 5-line
template, so it shows real subject -> qualification -> course -> career ->
specialisation stages, while keeping the same `{age, milestone}` shape the
frontend already rendered (plus optional `type`/`refIds` for richer UI).

## Data accuracy disclaimer

All course/university/qualification figures (UCAS points, fees, employability
rates, salaries) are **illustrative placeholders** for this prototype, in the
same spirit as the original `careers.json` ("replace/expand with real
ONS/UCAS/HESA-sourced data before going further than a prototype"). Treat
every number as a stand-in shape for where licensed UCAS/HESA/Discover Uni
data should go, not as advice.

## Phase 2: the Future Map graph view

Phase 2 reframes the product around the user's bigger recommendation: **"visualise
every possible future from the choices you make today,"** rather than just
"student -> job." This is now a real, explorable graph, not just a data model.

- **`data/qualifications.json`** was extended from a single-track ladder into a true
  branching tree: GCSEs branch into A-Level/BTEC/T-Level/Apprenticeship; those branch
  into Degree/Degree-Apprenticeship/Foundation Year/Gap Year; Gap Year branches into
  Study Abroad or Start a Business; everything eventually funnels into a Graduate Job
  and onward into a Senior/Established Role. Every entry has a `nodeType`
  (`qualification` / `apprenticeship` / `certification` / `life-stage` / `career-stage`)
  so the graph can colour and group them.
- **`data/industries.json`** (new) gives "industry" its own browsable node, derived
  1:1 from the `category` already on each career.
- **`lib/graph.js`** (new) builds one unified, typed node/edge grap