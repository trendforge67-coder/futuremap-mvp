# Phase 4 — AI Future Planner: All Code Changes

Paste each section into the correct file in VS Code.
After all changes, restart the server: `node server.js`

---

## 1. NEW FILE: `lib/futurePlanner.js`

Create this file at `lib/futurePlanner.js` in your project root.

```js
// lib/futurePlanner.js
// Deterministic AI Future Planner engine.
// generateFutures(profile) -> three real, graph-validated career paths.
// answerQuestion(question, profile) -> grounded answer + optional highlight path.
// No data is invented: every path is validated against real edges in lib/graph.js.

"use strict";

const { GRAPH } = require("./graph.js");
const { scoreCareer, CAREERS } = require("./scoring.js");

const SUBJECTS = JSON.parse(
  require("fs").readFileSync(require("path").join(__dirname, "../data/subjects.json"), "utf8")
);
const COURSES = JSON.parse(
  require("fs").readFileSync(require("path").join(__dirname, "../data/courses.json"), "utf8")
);
const UNIVERSITIES = JSON.parse(
  require("fs").readFileSync(require("path").join(__dirname, "../data/universities.json"), "utf8")
);

// Pre-build edge set for path validation: "from|to" -> true
const EDGE_SET = new Set(GRAPH.edges.map((e) => `${e.from}|${e.to}`));
function edgeExists(a, b) { return EDGE_SET.has(`${a}|${b}`) || EDGE_SET.has(`${b}|${a}`); }

// ---- Work style definitions -----------------------------------------------
const WORK_STYLES = {
  "build-things":         { label: "Build things",                 interests: ["technology"],        skills: ["programming", "problem-solving"],    categories: ["Technology"] },
  "research-ideas":       { label: "Research new ideas",           interests: ["science", "maths"],  skills: ["problem-solving", "logic"],          categories: ["Science", "Medicine"] },
  "solve-business":       { label: "Solve business problems",      interests: ["business"],          skills: ["leadership", "communication"],       categories: ["Business", "Finance"] },
  "help-people":          { label: "Help people",                  interests: ["helping-others"],    skills: ["communication", "resilience"],       categories: ["Healthcare", "Education", "Social"] },
  "create-communicate":   { label: "Create & communicate",         interests: ["creativity"],        skills: ["creativity", "communication"],       categories: ["Creative", "Media"] },
};

function subjectOptions() {
  return SUBJECTS.map((s) => ({ id: s.id, name: s.name }));
}

function workStyleOptions() {
  return Object.entries(WORK_STYLES).map(([id, w]) => ({ id, label: w.label }));
}

// ---- Scoring ---------------------------------------------------------------
function buildScoringProfile(subjectIds, workStyleId) {
  const ws = WORK_STYLES[workStyleId] || {};
  const subjectObjs = SUBJECTS.filter((s) => subjectIds.includes(s.id));
  const skills = [...new Set([...(ws.skills || []), ...subjectObjs.flatMap((s) => s.relatedSkills || [])])];
  return {
    subjects: subjectIds,
    interests: ws.interests || [],
    skills,
    goals: [],
    _categories: ws.categories || [],
  };
}

function scoreAllCareers(profile) {
  return CAREERS.map((career) => {
    const result = scoreCareer(profile, career);
    const catBonus = (profile._categories || []).some((c) => career.category === c) ? 0.18 : 0;
    return { career, score: Math.min(1, result.fitRaw + catBonus), blocked: result.blocked };
  }).filter((r) => !r.blocked).sort((a, b) => b.score - a.score);
}

function pickDiverse(scored, n) {
  const seen = new Set();
  const out = [];
  for (const r of scored) {
    if (out.length >= n) break;
    if (!seen.has(r.career.category)) { seen.add(r.career.category); out.push(r); }
  }
  for (const r of scored) {
    if (out.length >= n) break;
    if (!out.includes(r)) out.push(r);
  }
  return out.slice(0, n);
}

// ---- Path helpers ----------------------------------------------------------
function nid(type, id) { return `${type}:${id}`; }

function nodeLabel(id) {
  const n = GRAPH.nodes.find((x) => x.id === id);
  return n ? n.label : id;
}

function courseForCareer(career) {
  // Only trust a course where BOTH career.courseIds and course.careerIds agree.
  for (const cid of (career.courseIds || [])) {
    const course = COURSES.find((c) => c.id === cid && (c.careerIds || []).includes(career.id));
    if (course) return course;
  }
  // Fallback: course-side only
  return COURSES.find((c) => (c.careerIds || []).includes(career.id)) || null;
}

function buildValidatedPath(rawIds) {
  if (!rawIds.length) return [];
  const out = [rawIds[0]];
  for (let i = 1; i < rawIds.length; i++) {
    if (edgeExists(rawIds[i - 1], rawIds[i])) out.push(rawIds[i]);
  }
  return out;
}

function describePath(rawIds, label, color) {
  const nodeIds = buildValidatedPath(rawIds);
  const steps = nodeIds.map((id) => ({ id, label: nodeLabel(id) }));
  return { label, color, nodeIds, steps };
}

// ---- generateFutures -------------------------------------------------------
function generateFutures({ subjectIds = [], workStyle = null } = {}) {
  if (!subjectIds.length && !workStyle) {
    return { futures: [], matchedCareers: [], message: "Pick at least one subject or work style to get started." };
  }

  const profile = buildScoringProfile(subjectIds, workStyle);
  const scored = scoreAllCareers(profile);
  if (!scored.length) return { futures: [], matchedCareers: [] };

  const [top, second] = pickDiverse(scored, 2);
  const topCareer = top.career;
  const secondCareer = second ? second.career : topCareer;
  const topCourse = courseForCareer(topCareer);
  const secondCourse = courseForCareer(secondCareer);

  const root = GRAPH.rootId; // "start:start"
  const gcse = nid("qualification-stage", "gcse");
  const aLevel = nid("qualification-stage", "a-level");
  const degree = nid("qualification-stage", "degree");
  const apprenticeship = nid("qualification-stage", "apprenticeship");
  const degreeApp = nid("qualification-stage", "degree-apprenticeship");
  const foundationYear = nid("qualification-stage", "foundation-year");
  const gradJob = nid("qualification-stage", "graduate-job");
  const seniorRole = nid("qualification-stage", "senior-role");

  const futures = [];

  // Future A: Academic (GCSE -> A-Levels -> Degree -> Course -> Career -> Specialisation)
  if (topCourse) {
    const courseNode = nid("course", topCourse.id);
    const careerNode = nid("career", topCareer.id);
    const specNode = nid("specialisation", `${topCareer.id}-senior`);
    futures.push(describePath([root, gcse, aLevel, degree, courseNode, careerNode, specNode],
      `${topCareer.title} -- Academic route (A-Levels -> Degree)`, "#6366F1"));
  }

  // Future B: Degree Apprenticeship (GCSE -> Apprenticeship -> Degree App -> Course -> Career -> Spec)
  if (topCourse) {
    const courseNode = nid("course", topCourse.id);
    const careerNode = nid("career", topCareer.id);
    const specNode = nid("specialisation", `${topCareer.id}-senior`);
    futures.push(describePath([root, gcse, apprenticeship, degreeApp, courseNode, careerNode, specNode],
      `${topCareer.title} -- Degree Apprenticeship route (earn while you learn)`, "#F2A93B"));
  }

  // Future C: Extended / specialist (via second career or foundation year route)
  const extCourse = secondCourse || topCourse;
  const extCareer = extCourse === secondCourse ? secondCareer : topCareer;
  if (extCourse) {
    const courseNode = nid("course", extCourse.id);
    const careerNode = nid("career", extCareer.id);
    const specNode = nid("specialisation", `${extCareer.id}-senior`);
    futures.push(describePath(
      [root, gcse, aLevel, foundationYear, degree, courseNode, careerNode, gradJob, seniorRole, specNode],
      `${extCareer.title} -- Extended / specialist route (the road less travelled)`, "#C2185B"));
  }

  return {
    futures,
    matchedCareers: [topCareer.title, ...(second ? [secondCareer.title] : [])],
  };
}

// ---- answerQuestion --------------------------------------------------------
const GRADE_POINTS = { "A*": 56, A: 48, B: 40, C: 32, D: 24, E: 16 };

function gradesToPoints(str) {
  let total = 0;
  const matches = str.toUpperCase().match(/A\*|[A-E]/g) || [];
  matches.forEach((g) => { total += GRADE_POINTS[g] || 0; });
  return total;
}

function fastestGrowingCareers(n = 5) {
  return [...CAREERS].sort((a, b) => (b.growthScore || 0) - (a.growthScore || 0)).slice(0, n);
}

const SYNONYMS = {
  coding: "programming", math: "maths", maths: "maths",
  talking: "communication", speaking: "communication",
  drawing: "creativity", art: "creativity", designing: "design",
  research: "problem-solving", managing: "leadership",
  leading: "leadership", management: "leadership", risk: "risk-tolerance",
};
function normaliseTerm(t) { return SYNONYMS[t.toLowerCase().trim()] || t.toLowerCase().trim(); }

function answerQuestion(question, profile = {}) {
  const q = question.toLowerCase();

  // 1. No university
  if (/(without (a |the )?(university|uni\b|degree))|((don'?t|do not|doesn'?t|does not|not) (go(ing)?|attend(ing)?) to (a |the )?(uni\b|university))|(skip(ping)? (university|uni\b))|(no (university|uni\b))/.test(q)) {
    const root = GRAPH.rootId;
    const gcse = nid("qualification-stage", "gcse");
    const app = nid("qualification-stage", "apprenticeship");
    const degApp = nid("qualification-stage", "degree-apprenticeship");
    const gradJob = nid("qualification-stage", "graduate-job");

    const profile2 = buildScoringProfile(profile.subjectIds || [], profile.workStyle || null);
    const scored = scoreAllCareers(profile2);
    const top = scored[0];
    const course = top ? courseForCareer(top.career) : null;
    const careerNode = top ? nid("career", top.career.id) : null;
    const courseNode = course ? nid("course", course.id) : null;
    const specNode = top ? nid("specialisation", `${top.career.id}-senior`) : null;

    const rawPath = courseNode && careerNode
      ? [root, gcse, app, degApp, courseNode, careerNode, specNode].filter(Boolean)
      : [root, gcse, app, degApp, gradJob];

    const careerName = top ? top.career.title : "your chosen career";
    return {
      answer: `Yes -- a degree apprenticeship is a real route into ${careerName}: you work and get paid from day one while studying toward a full degree, with no tuition debt. The qualification ladder also allows GCSEs -> Apprenticeship -> Degree Apprenticeship -> Graduate Job directly, skipping a traditional university place entirely.`,
      highlight: [describePath(rawPath, "Degree Apprenticeship route", "#F2A93B")],
    };
  }

  // 2. Without A-Levels
  if (/without .*a[\s-]?levels?/.test(q)) {
    const root = GRAPH.rootId;
    const gcse = nid("qualification-stage", "gcse");
    const app = nid("qualification-stage", "apprenticeship");
    const degApp = nid("qualification-stage", "degree-apprenticeship");
    return {
      answer: "Yes -- a degree apprenticeship (GCSE -> Apprenticeship -> Degree Apprenticeship) skips A-Levels entirely while still earning a full degree. BTECs and T-Levels are also A-Level alternatives that lead to the same higher education routes.",
      highlight: [describePath([root, gcse, app, degApp], "Route without A-Levels", "#F2A93B")],
    };
  }

  // 3. Subject switch
  const switchMatch = q.match(/switch(?:ed|ing)? from ([a-z &-]+?) to ([a-z &-]+?)([.?!]|$)/);
  if (switchMatch) {
    const toName = switchMatch[2].trim();
    const toSubject = SUBJECTS.find((s) => s.name.toLowerCase().includes(toName) || s.id.includes(toName.replace(/\s+/g, "-")));
    if (toSubject) {
      const levelId = (toSubject.levels || []).includes("a-level") ? "a-level" : (toSubject.levels || [])[0];
      const subjectNode = nid("subject", toSubject.id);
      const stageNode = levelId ? nid("qualification-stage", levelId) : null;
      const path = stageNode ? [subjectNode, stageNode] : [subjectNode];
      const unlocks = (toSubject.unlocksCourseIds || [])
        .map((cid) => COURSES.find((c) => c.id === cid))
        .filter(Boolean)
        .map((c) => c.title)
        .join(", ");
      return {
        answer: `Switching to ${toSubject.name} opens up: ${unlocks || "a range of courses depending on your other subjects"}. It's studied at ${(toSubject.levels || []).join(", ")} level.`,
        highlight: path.length > 1 ? [describePath(path, `Switch to ${toSubject.name}`, "#6366F1")] : [],
      };
    }
  }

  // 4. Which universities are realistic for grades
  if (/realistic.*grade|grade.*realistic|which universit(y|ies).*grade/.test(q)) {
    const points = gradesToPoints(q);
    const matches = [];
    UNIVERSITIES.forEach((uni) => {
      (uni.offerings || []).forEach((o) => {
        if (o.ucasPoints && o.ucasPoints <= points + 8) {
          matches.push(`${uni.name} (${COURSES.find((c) => c.id === o.courseId)?.title || o.courseId}, ${o.typicalGrades})`);
        }
      });
    });
    return {
      answer: matches.length
        ? `With those grades (~${points} UCAS points), realistic options include: ${matches.slice(0, 6).join("; ")}.`
        : "Enter your grades as letters (e.g. 'realistic for ABB') so I can match them against university entry requirements.",
      highlight: [],
    };
  }

  // 5. Fastest growing / next 10 years
  if (/fastest.growing|growing.fastest|next (5|10) years|highest demand/.test(q)) {
    const careers = fastestGrowingCareers(5);
    return {
      answer: `The five fastest-growing careers in this dataset by growth score: ${careers.map((c) => `${c.title} (score ${c.growthScore})`).join(", ")}.`,
      highlight: [],
    };
  }

  // 6. Enjoy X but dislike Y
  const enjoyMatch = q.match(/enjoy ([a-z\s-]+?) but (?:dislike|don'?t like|do not like|hate) ([a-z\s-]+)/);
  if (enjoyMatch) {
    const liked = normaliseTerm(enjoyMatch[1]);
    const disliked = normaliseTerm(enjoyMatch[2]);
    const matches = CAREERS.filter((c) => {
      const hasLiked = [...(c.skills || []), ...(c.interests || [])].some((x) => x.includes(liked));
      const hasDisliked = [...(c.skills || []), ...(c.interests || []), c.title.toLowerCase()].some((x) => x.includes(disliked));
      return hasLiked && !hasDisliked;
    });
    return {
      answer: matches.length
        ? `Careers matching "enjoy ${liked}, avoid ${disliked}": ${matches.map((c) => c.title).join(", ")}.`
        : `No exact matches found for that combination -- try broadening either term.`,
      highlight: [],
    };
  }

  // Fallback
  return {
    answer: `Here are some things you can ask me:\n• "What if I don't go to university?"\n• "Can I become a software engineer without A-Levels?"\n• "What if I switch from Biology to Chemistry?"\n• "Which universities are realistic for AAB?"\n• "If I enjoy maths but dislike coding, what should I study?"\n• "What careers are growing fastest over the next 10 years?"`,
    highlight: [],
  };
}

module.exports = { generateFutures, answerQuestion, subjectOptions, workStyleOptions, WORK_STYLES };
```

---

## 2. NEW FILE: `public/planner.js`

Create this file at `public/planner.js`.

```js
// public/planner.js
// AI Future Planner frontend.
// Interview (subjects + work style) -> POST /api/future-plan -> three futures.
// Each future card has a "Show on map" button. Q&A box below wires to /api/future-qa.

const aiSelectedSubjects = new Set();
let aiSelectedWorkStyle = null;
let aiLastProfile = { subjectIds: [], workStyle: null };
let aiOptionsLoaded = false;

async function loadAiOptions() {
  if (aiOptionsLoaded) return;
  aiOptionsLoaded = true;
  const res = await fetch("/api/future-options");
  const data = await res.json();

  const subjectsEl = document.getElementById("ai-subjects-group");
  data.subjects.forEach((s) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = s.name;
    chip.dataset.id = s.id;
    chip.onclick = () => {
      if (aiSelectedSubjects.has(s.id)) {
        aiSelectedSubjects.delete(s.id);
        chip.classList.remove("selected");
      } else {
        aiSelectedSubjects.add(s.id);
        chip.classList.add("selected");
      }
    };
    subjectsEl.appendChild(chip);
  });

  const styleEl = document.getElementById("ai-workstyle-group");
  data.workStyles.forEach((w) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = w.label;
    chip.dataset.id = w.id;
    chip.onclick = () => {
      document.querySelectorAll("#ai-workstyle-group .chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      aiSelectedWorkStyle = w.id;
    };
    styleEl.appendChild(chip);
  });
}

function showFuturesOnMap(paths) {
  const mapTabBtn = document.querySelector('.tab-btn[data-tab="futuremap"]');
  if (mapTabBtn) mapTabBtn.click();
  Promise.resolve(window.FutureMapGraph.init("future-map-canvas", "graph-detail-panel", "graph-legend")).then(() => {
    window.FutureMapGraph.showPaths(paths);
  });
}

function futureCardHtml(future, index) {
  const stepsHtml = future.steps
    .map((s) => `<div class="node"><div class="age">${s.label}</div></div>`)
    .join("");
  return `
  <div class="path-card future-card" data-future-index="${index}">
    <h3><span class="rank-badge" style="background:${future.color};color:#fff;">${index + 1}</span>${future.label}</h3>
    <div class="roadmap">${stepsHtml}</div>
    <button class="ghost ai-show-one-btn" data-future-index="${index}">Show this future on the map</button>
  </div>`;
}

async function generateFutures() {
  const hint = document.getElementById("ai-generate-hint");
  const btn = document.getElementById("ai-generate-btn");
  const resultsEl = document.getElementById("ai-futures-results");
  hint.style.display = "block";
  btn.disabled = true;

  aiLastProfile = { subjectIds: [...aiSelectedSubjects], workStyle: aiSelectedWorkStyle };

  try {
    const res = await fetch("/api/future-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(aiLastProfile),
    });
    const data = await res.json();

    if (!data.futures || !data.futures.length) {
      resultsEl.innerHTML = `<p class="muted">${data.message || "Pick at least one subject to get started."}</p>`;
      return;
    }

    window._aiFutures = data.futures;
    const matchLine = data.matchedCareers
      ? `<p class="muted">Best-fit careers for this profile: ${data.matchedCareers.join(", ")}.</p>`
      : "";
    resultsEl.innerHTML =
      `<h2>Your three futures</h2>${matchLine}` +
      data.futures.map(futureCardHtml).join("") +
      `<button class="primary" id="ai-show-all-btn">Show all three futures on the map</button>`;

    document.getElementById("ai-show-all-btn").onclick = () => showFuturesOnMap(window._aiFutures);
  } catch (e) {
    resultsEl.innerHTML = `<p class="muted">Something went wrong: ${e.message}</p>`;
  } finally {
    hint.style.display = "none";
    btn.disabled = false;
  }
}

document.addEventListener("click", (e) => {
  const oneBtn = e.target.closest(".ai-show-one-btn");
  if (oneBtn && window._aiFutures) {
    const idx = Number(oneBtn.dataset.futureIndex);
    showFuturesOnMap([window._aiFutures[idx]]);
  }
});

async function askFutureQuestion() {
  const input = document.getElementById("ai-qa-input");
  const question = input.value.trim();
  const resultsEl = document.getElementById("ai-qa-results");
  if (!question) return;

  resultsEl.innerHTML = `<p class="muted">Thinking...</p>`;
  try {
    const res = await fetch("/api/future-qa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, profile: aiLastProfile }),
    });
    const data = await res.json();
    const hasHighlight = data.highlight && data.highlight.length;
    window._aiQaHighlight = data.highlight || [];
    resultsEl.innerHTML = `
      <div class="path-card">
        <p>${data.answer}</p>
        ${hasHighlight ? `<button class="ghost" id="ai-qa-show-btn">Show this on the map</button>` : ""}
      </div>`;
    if (hasHighlight) {
      document.getElementById("ai-qa-show-btn").onclick = () => showFuturesOnMap(window._aiQaHighlight);
    }
  } catch (e) {
    resultsEl.innerHTML = `<p class="muted">Something went wrong: ${e.message}</p>`;
  }
}

document.getElementById("ai-generate-btn").addEventListener("click", generateFutures);
document.getElementById("ai-qa-btn").addEventListener("click", askFutureQuestion);
document.getElementById("ai-qa-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") askFutureQuestion();
});

loadAiOptions();
```

---

## 3. EDIT: `public/index.html`

### a) In the `<nav class="tabs">` block, add this as the FIRST button:
```html
<button class="tab-btn" data-tab="ai-planner">AI Future Planner</button>
```

### b) Add this entire section BEFORE the `<section id="tab-planner"` line:
```html
<section id="tab-ai-planner" class="tab-panel">
  <div class="card ai-interview-card">
    <p class="hint">Answer a couple of quick questions and the AI will generate three real, connected futures on the map -- then you can ask it follow-up questions and watch the map update.</p>
    <label>What subjects do you enjoy the most?</label>
    <div class="chip-group" id="ai-subjects-group"></div>
    <label>Would you rather...</label>
    <div class="chip-group" id="ai-workstyle-group"></div>
    <button class="primary" id="ai-generate-btn">Generate my three futures</button>
    <p class="muted" id="ai-generate-hint" style="display:none;">Thinking it through against the real course/career graph...</p>
  </div>
  <div id="ai-futures-results"></div>
  <div class="card ai-qa-card">
    <label>Ask about your future</label>
    <p class="hint">Try: "What if I don't go to university?", "Can I become a software engineer without A-Levels?", "What if I switch from Biology to Chemistry?", "Which universities are realistic for AAB?", "If I enjoy maths but dislike coding, what should I study?", or "What careers are growing fastest?"</p>
    <input type="text" id="ai-qa-input" placeholder="Type a question about your future..." />
    <button class="primary" id="ai-qa-btn">Ask</button>
    <div id="ai-qa-results"></div>
  </div>
</section>
```

### c) Just before `</body>`, add:
```html
<script src="/planner.js"></script>
```

---

## 4. EDIT: `server.js`

### a) At the top with the other `require` lines, add:
```js
const futurePlanner = require("./lib/futurePlanner.js");
```

### b) Find the comment `// ---- Static files ----` and add these three blocks JUST BEFORE it:
```js
// AI Future Planner API
if (pathname === "/api/future-options" && req.method === "GET") {
  return send(res, 200, {
    subjects: futurePlanner.subjectOptions(),
    workStyles: futurePlanner.workStyleOptions(),
  });
}

if (pathname === "/api/future-plan" && req.method === "POST") {
  try {
    const profile = await readJsonBody(req);
    const result = futurePlanner.generateFutures(profile);
    return send(res, 200, result);
  } catch (e) {
    console.error(e);
    return send(res, 400, { error: "invalid request", detail: String(e.message || e) });
  }
}

if (pathname === "/api/future-qa" && req.method === "POST") {
  try {
    const { question, profile } = await readJsonBody(req);
    const result = futurePlanner.answerQuestion(question, profile || {});
    return send(res, 200, result);
  } catch (e) {
    console.error(e);
    return send(res, 400, { error: "invalid request", detail: String(e.message || e) });
  }
}
```

---

## 5. EDIT: `public/styles.css`

Add at the very bottom of the file:

```css
/* AI Future Planner */
.ai-interview-card label:first-of-type { margin-top: 4px; }
.future-card .roadmap .node { min-width: 120px; }
.future-card .roadmap .node .age { color: var(--navy); font-size: 12.5px; }
#ai-show-all-btn { margin-top: 4px; }
.ai-qa-card { margin-top: 24px; }
.ai-qa-card input[type="text"] { margin-bottom: 10px; }
#ai-qa-results .path-card { margin-top: 14px; }
#ai-qa-results .path-card button { margin-top: 6px; }
```

---

## 6. EDIT: `public/graph.js`

Find the `window.FutureMapGraph = {` block near the bottom and replace it entirely with:

```js
  window.FutureMapGraph = {
    instance: null,
    init(canvasId, panelId, legendId) {
      if (this.instance) {
        this.instance._resizeCanvas();
        return Promise.resolve();
      }
      const canvas = document.getElementById(canvasId);
      const panel = document.getElementById(panelId);
      const legend = document.getElementById(legendId);
      this.instance = new FutureMapGraph(canvas, panel, legend);
      return this.instance.load();
    },
    resetView() {
      if (this.instance) this.instance.resetView();
    },
    clearHighlight() {
      if (this.instance) this.instance.clearHighlights();
    },
    clearHighlights() {
      if (this.instance) this.instance.clearHighlights();
    },
    showPaths(paths) {
      if (this.instance) this.instance.setHighlights(paths);
    },
    nodeId(type, rawId) {
      return `${type}:${rawId}`;
    },
    isReady() {
      return !!(this.instance && this.instance.nodes.length);
    },
  };
```

Also add these two methods to the prototype (anywhere before the `window.FutureMapGraph` block):

```js
  FutureMapGraph.prototype.setHighlights = function (paths, opts = {}) {
    this.highlights = paths.map((p) => {
      const nodeIds = new Set(p.nodeIds);
      const edgeKeys = new Set();
      const arr = p.nodeIds;
      for (let i = 0; i < arr.length - 1; i++) {
        edgeKeys.add(`${arr[i]}|${arr[i + 1]}`);
        edgeKeys.add(`${arr[i + 1]}|${arr[i]}`);
      }
      arr.forEach((id) => this.expanded.add(id));
      return { nodeIds, edgeKeys, color: p.color || "#F2A93B", label: p.label };
    });
    if (opts.fit !== false) {
      const allIds = new Set();
      paths.forEach((p) => p.nodeIds.forEach((id) => allIds.add(id)));
      this._fitToNodes([...allIds]);
    }
  };

  FutureMapGraph.prototype.clearHighlights = function () {
    this.highlights = [];
    if (this.selectedId) {
      const n = this.byId.get(this.selectedId);
      if (n) this._showDetail(n);
    }
  };

  FutureMapGraph.prototype.clearHighlight = FutureMapGraph.prototype.clearHighlights;

  FutureMapGraph.prototype._fitToNodes = function (nodeIds) {
    const pts = nodeIds.map((id) => this.byId.get(id)).filter(Boolean);
    if (!pts.length) return;
    const minX = Math.min(...pts.map((n) => n.x));
    const maxX = Math.max(...pts.map((n) => n.x));
    const minY = Math.min(...pts.map((n) => n.y));
    const maxY = Math.max(...pts.map((n) => n.y));
    const w = Math.max(60, maxX - minX);
    const h = Math.max(60, maxY - minY);
    const pad = 1.35;
    const scale = Math.max(0.18, Math.min(2.2, Math.min(this.canvas.width / (w * pad), this.canvas.height / (h * pad))));
    this.scale = scale;
    this.offsetX = this.canvas.width / 2 - ((minX + maxX) / 2) * scale;
    this.offsetY = this.canvas.height / 2 - ((minY + maxY) / 2) * scale;
  };
```

---

## Done — restart the server

```
node server.js
```

Then open `http://localhost:3000` — "AI Future Planner" will be the first tab.
