// AI Future Planner.
//
// Deliberately NOT a free-form LLM call for the core logic -- same philosophy
// as lib/scoring.js: deterministic, explainable, grounded in the real graph
// (lib/graph.js) and the real career/subject data, so every node it points
// at and every number it states actually exists in data/*.json. An LLM is
// only ever appropriate here for *phrasing* an answer, never for inventing
// a path or a number -- and that hook is not wired in by default (no
// ANTHROPIC_API_KEY dependency), to keep this fully usable offline.
//
// Two jobs:
//   generateFutures(profile)  -- the interview ("what subjects do you enjoy,
//     build/research/solve?") turns into three distinct, real, walkable
//     paths through the graph.
//   answerQuestion(question, profile) -- the live "ask about your future" box.
//     Recognises a fixed set of question shapes (the ones in the Phase 4
//     brief) and answers from real data, optionally returning a path to
//     highlight on the map.

const fs = require("fs");
const path = require("path");
const { GRAPH, nid } = require("./graph.js");
const { scoreCareer, CAREERS } = require("./scoring.js");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", file), "utf-8"));
}
const SUBJECTS = loadJson("subjects.json");
const COURSES = loadJson("courses.json");
const QUALIFICATIONS = loadJson("qualifications.json");
const UNIVERSITIES = loadJson("universities.json");

// Fast lookup of every real edge in the graph, so any path we build can be
// validated -- if a step isn't actually connected, we drop it rather than
// show a broken / fabricated jump on the map.
const EDGE_SET = new Set(GRAPH.edges.map((e) => `${e.from}|${e.to}`));
function edgeExists(a, b) {
  return EDGE_SET.has(`${a}|${b}`) || EDGE_SET.has(`${b}|${a}`);
}

// ---- "What do you enjoy doing" -> interests/skills/categories -------------
const WORK_STYLES = {
  "build-things": {
    label: "Build things",
    interests: ["technology", "gaming", "design"],
    skills: ["programming", "problem-solving"],
    categories: ["tech", "engineering", "design-tech", "tech-creative"],
  },
  "research-ideas": {
    label: "Research new ideas",
    interests: ["science", "problem-solving"],
    skills: ["logic", "maths"],
    categories: ["science", "medicine", "education"],
  },
  "solve-business": {
    label: "Solve business problems",
    interests: ["business", "communication"],
    skills: ["leadership", "communication"],
    categories: ["business", "business-tech", "finance", "law"],
  },
  "help-people": {
    label: "Help and care for people",
    interests: ["helping-others", "psychology"],
    skills: ["communication", "resilience"],
    categories: ["healthcare", "medicine", "education"],
  },
  "create-communicate": {
    label: "Create and communicate",
    interests: ["creativity", "writing", "design"],
    skills: ["creativity", "communication"],
    categories: ["media", "design", "design-tech"],
  },
};

function subjectOptions() {
  return SUBJECTS.map((s) => ({ id: s.id, name: s.name }));
}

function workStyleOptions() {
  return Object.entries(WORK_STYLES).map(([id, w]) => ({ id, label: w.label }));
}

// Build a {subjects, interests, skills} scoring profile from interview answers.
function buildScoringProfile(subjectIds = [], workStyleId) {
  const chosenSubjects = SUBJECTS.filter((s) => subjectIds.includes(s.id));
  const subjectNames = chosenSubjects.map((s) => s.name);
  const subjectSkills = chosenSubjects.flatMap((s) => s.relatedSkills || []);
  const style = WORK_STYLES[workStyleId];
  const interests = style ? [...style.interests] : [];
  const skills = [...new Set([...(style ? style.skills : []), ...subjectSkills])];
  return { subjects: subjectNames, interests, skills, goals: [], _categories: style ? style.categories : [] };
}

// Score every career, with an extra nudge for categories matching the chosen
// work style (scoring.js itself has no concept of "category preference" --
// that's specific to the planner's interview, so it's applied here rather
// than polluting the shared scoring engine).
function scoreAllCareers(profile) {
  return CAREERS.map((c) => {
    const base = scoreCareer(profile, c);
    const categoryBonus = profile._categories && profile._categories.includes(c.category) ? 0.18 : 0;
    return { ...base, fitRaw: Math.min(1, base.fitRaw + categoryBonus) };
  }).filter((s) => !s.blocked);
}

function pickDiverse(scored, n) {
  const sorted = [...scored].sort((a, b) => b.fitRaw - a.fitRaw);
  const chosen = [];
  const usedCategories = new Set();
  for (const item of sorted) {
    if (chosen.length >= n) break;
    if (usedCategories.has(item.career.category)) continue;
    chosen.push(item);
    usedCategories.add(item.career.category);
  }
  for (const item of sorted) {
    if (chosen.length >= n) break;
    if (!chosen.includes(item)) chosen.push(item);
  }
  return chosen.slice(0, n);
}

function courseForCareer(career) {
  const ids = career.courseIds || [];
  // The actual graph edge (course --leads-to--> career) is built from the
  // COURSE's careerIds, not the career's courseIds -- the two lists are
  // mostly mirrored in the data but not always (a few careers list a course
  // the course itself doesn't claim to lead to). Only trust a pairing where
  // both sides agree, so we never point at a path step with no real edge.
  for (const id of ids) {
    const course = COURSES.find((c) => c.id === id && (c.careerIds || []).includes(career.id));
    if (course) return course;
  }
  // fall back: any course that lists this career, even if the career didn't
  // list it back.
  return COURSES.find((c) => (c.careerIds || []).includes(career.id)) || null;
}

// Build a validated chain of graph node ids -- drops any step whose edge to
// the next step doesn't actually exist, so the result is always a real,
// connected, walkable route.
function buildValidatedPath(rawIds) {
  const out = [rawIds[0]];
  for (let i = 1; i < rawIds.length; i++) {
    const prev = out[out.length - 1];
    if (edgeExists(prev, rawIds[i])) out.push(rawIds[i]);
    // if the edge doesn't exist, skip this step entirely rather than break
    // the chain with a fabricated jump.
  }
  return out;
}

function nodeLabel(id) {
  const n = GRAPH.nodes.find((x) => x.id === id);
  return n ? n.label : id;
}

function describePath(rawIds, label, color) {
  const path = buildValidatedPath(rawIds);
  return {
    label,
    color,
    nodeIds: path,
    steps: path.map((id) => ({ id, label: nodeLabel(id) })),
  };
}

const ROOT = GRAPH.rootId; // "start:start"

// ---- generateFutures -------------------------------------------------------
function generateFutures(profile) {
  const scoringProfile = buildScoringProfile(profile.subjectIds, profile.workStyle);
  const scored = scoreAllCareers(scoringProfile);
  const top = pickDiverse(scored, 2);

  if (!top.length) {
    return { futures: [], message: "Couldn't find a strong match yet -- try picking a few more subjects." };
  }

  const careerA = top[0].career;
  const careerB = top[1] ? top[1].career : top[0].career;
  const courseA = courseForCareer(careerA);
  const courseB = courseForCareer(careerB);

  const futures = [];

  if (courseA) {
    futures.push(
      describePath(
        [
          ROOT,
          nid("qualification-stage", "gcse"),
          nid("qualification-stage", "a-level"),
          nid("qualification-stage", "degree"),
          nid("course", courseA.id),
          nid("career", careerA.id),
          nid("specialisation", `${careerA.id}-senior`),
        ],
        `${careerA.title} -- Academic route (A-Levels -> Degree)`,
        "#6366F1"
      )
    );
    futures.push(
      describePath(
        [
          ROOT,
          nid("qualification-stage", "gcse"),
          nid("qualification-stage", "apprenticeship"),
          nid("qualification-stage", "degree-apprenticeship"),
          nid("course", courseA.id),
          nid("career", careerA.id),
          nid("specialisation", `${careerA.id}-senior`),
        ],
        `${careerA.title} -- Degree Apprenticeship route (earn while you learn)`,
        "#F2A93B"
      )
    );
  }

  if (courseB) {
    futures.push(
      describePath(
        [
          ROOT,
          nid("qualification-stage", "gcse"),
          nid("qualification-stage", "a-level"),
          nid("qualification-stage", "foundation-year"),
          nid("qualification-stage", "degree"),
          nid("course", courseB.id),
          nid("career", careerB.id),
          nid("qualification-stage", "graduate-job"),
          nid("qualification-stage", "senior-role"),
          nid("specialisation", `${careerB.id}-senior`),
        ],
        `${careerB.title} -- Extended / specialist route (the road less travelled)`,
        "#C2185B"
      )
    );
  }

  return {
    futures: futures.slice(0, 3),
    matchedCareers: [careerA.title, careerB.title],
  };
}

// ---- answerQuestion ---------------------------------------------------------
const GRADE_POINTS = { "A*": 56, A: 48, B: 40, C: 32, D: 24, E: 16 };
function gradesToPoints(str) {
  const matches = str.toUpperCase().match(/A\*|[A-E]/g);
  if (!matches) return null;
  return matches.reduce((sum, g) => sum + (GRADE_POINTS[g] || 0), 0);
}

function fastestGrowingCareers() {
  return [...CAREERS].sort((a, b) => b.growthScore - a.growthScore).slice(0, 5);
}

function answerQuestion(question, profile = {}) {
  const q = (question || "").toLowerCase();

  // 1. "without university / a degree" -- covers "without", "don't/doesn't go
  // to", "not go(ing) to", "skip", and "no university" phrasings.
  if (/(without (a |the )?(university|uni\b|degree))|((don'?t|do not|doesn'?t|does not|not) (go(ing)?|going|attend(ing)?) to (a |the )?(uni\b|university))|(skip(ping)? (university|uni\b))|(no (university|uni\b))/.test(q)) {
    const scoringProfile = buildScoringProfile(profile.subjectIds, profile.workStyle);
    const scored = scoreAllCareers(scoringProfile);
    const top = pickDiverse(scored, 1)[0];
    const career = top ? top.career : CAREERS.find((c) => c.id === "ai-engineer") || CAREERS[0];
    const course = courseForCareer(career);
    const path = course
      ? describePath(
          [ROOT, nid("qualification-stage", "gcse"), nid("qualification-stage", "apprenticeship"), nid("qualification-stage", "degree-apprenticeship"), nid("course", course.id), nid("career", career.id)],
          `${career.title} via Degree Apprenticeship`,
          "#F2A93B"
        )
      : null;
    return {
      answer: `Yes -- a degree apprenticeship is a real route into ${career.title}: you work and get paid from day one while studying toward a full degree, with no tuition debt. The qualification ladder also allows GCSEs -> Apprenticeship -> Degree Apprenticeship -> Graduate Job directly, skipping a traditional university place entirely.`,
      highlight: path ? [path] : [],
    };
  }

  // 2. "without A-Levels"
  if (/without .*a[\s-]?levels?/.test(q)) {
    const path = describePath(
      [ROOT, nid("qualification-stage", "gcse"), nid("qualification-stage", "apprenticeship"), nid("qualification-stage", "graduate-job"), nid("qualification-stage", "senior-role")],
      "GCSE -> Apprenticeship -> Graduate Job (no A-Levels needed)",
      "#2F8F77"
    );
    return {
      answer: "Yes. Apprenticeships, BTECs, and T-Levels are all valid routes straight from GCSEs that don't require traditional A-Levels -- they lead to a recognised qualification and a job at the same time, and several apprenticeship routes progress into a degree apprenticeship later if you decide you want a full degree after all.",
      highlight: [path],
    };
  }

  // 3. "switch from X to Y" subject swap
  const switchMatch = q.match(/switch(?:ed|ing)? from ([a-z &-]+?) to ([a-z &-]+?)([.?!]|$)/);
  if (switchMatch) {
    const fromName = switchMatch[1].trim();
    const toName = switchMatch[2].trim();
    const toSubject = SUBJECTS.find((s) => s.name.toLowerCase().includes(toName) || toName.includes(s.name.toLowerCase()));
    if (!toSubject) {
      return { answer: `I don't have "${toName}" as a subject in the current dataset -- try one of: ${SUBJECTS.map((s) => s.name).join(", ")}.`, highlight: [] };
    }
    const newSubjectIds = (profile.subjectIds || []).filter((id) => {
      const s = SUBJECTS.find((x) => x.id === id);
      return s && !s.name.toLowerCase().includes(fromName);
    });
    newSubjectIds.push(toSubject.id);
    const scoringProfile = buildScoringProfile(newSubjectIds, profile.workStyle);
    const scored = scoreAllCareers(scoringProfile);
    const top = pickDiverse(scored, 1)[0];
    if (!top) return { answer: `With ${toSubject.name} instead, I don't see a strong new match yet -- try adding another subject.`, highlight: [] };
    const course = courseForCareer(top.career);
    // Pick a qualification stage this subject is actually taken at (most
    // subjects list "a-level", but fall back to whatever's on file so the
    // subject -> stage edge we draw always exists).
    const levelId = (toSubject.levels || []).includes("a-level") ? "a-level" : (toSubject.levels || [])[0];
    const path = course && levelId
      ? describePath(
          [ROOT, nid("subject", toSubject.id), nid("qualification-stage", levelId), nid("qualification-stage", "degree"), nid("course", course.id), nid("career", top.career.id)],
          `With ${toSubject.name}: ${top.career.title}`,
          "#7C3AED"
        )
      : null;
    return {
      answer: `Swapping to ${toSubject.name} opens up courses like ${course ? course.title : "related subjects"}, and the best-fit career on that route becomes ${top.career.title} (fit ${Math.round(Math.min(top.fitRaw, 1) * 100)}%). ${toSubject.name} unlocks: ${(toSubject.unlocksCourseIds || []).join(", ") || "a similar set of courses"}.`,
      highlight: path ? [path] : [],
    };
  }

  // 4. "realistic for my grades"
  if (/realistic.*grade|grade.*realistic|which universit(y|ies).*grade/.test(q)) {
    const gradeMatch = question.match(/\b([A-E*]{2,4})\b/);
    if (!gradeMatch) {
      return {
        answer: "Tell me your predicted or achieved A-Level grades (e.g. \"AAB\") and I'll compare them against the typical entry grades on file for each university's course offering.",
        highlight: [],
      };
    }
    const points = gradesToPoints(gradeMatch[1]);
    const matches = [];
    UNIVERSITIES.forEach((u) => {
      (u.offerings || []).forEach((o) => {
        const diff = points - o.ucasPoints;
        matches.push({ uni: u.name, course: o.courseId, typicalGrades: o.typicalGrades, ucasPoints: o.ucasPoints, diff });
      });
    });
    matches.sort((a, b) => b.diff - a.diff);
    const realistic = matches.filter((m) => m.diff >= 0).slice(0, 5);
    const reach = matches.filter((m) => m.diff < 0 && m.diff >= -16).slice(0, 3);
    const lines = [
      realistic.length ? `Realistic with ${gradeMatch[1]}: ${realistic.map((m) => `${m.uni} (${m.course}, typically ${m.typicalGrades})`).join("; ")}.` : `${gradeMatch[1]} is below the typical offer for every course on file -- consider a foundation year route.`,
      reach.length ? `Worth a reach application: ${reach.map((m) => `${m.uni} (${m.course}, typically ${m.typicalGrades})`).join("; ")}.` : "",
    ].filter(Boolean);
    return { answer: lines.join(" "), highlight: [] };
  }

  // 5. "fastest growing careers"
  if (/fastest.growing|growing.fastest|next (5|10) years|highest demand/.test(q)) {
    const top = fastestGrowingCareers();
    return {
      answer: `Based on current outlook data, the fastest-growing careers on file are: ${top.map((c) => `${c.title} (${c.outlook})`).join("; ")}.`,
      highlight: [],
    };
  }

  // 6. "I enjoy X but dislike Y" -- nudge profile away from a skill/interest.
  // Free-text words ("coding", "maths") get mapped onto the controlled
  // skill/interest vocab so the filter actually matches career data, which
  // stores "programming" / "maths" / etc rather than every everyday synonym.
  const SYNONYMS = {
    coding: "programming", code: "programming", program: "programming",
    math: "maths", maths: "maths",
    writing: "writing", talking: "communication", presenting: "communication",
    drawing: "creativity", art: "creativity", designing: "design",
    science: "science", research: "problem-solving",
    business: "business", management: "leadership", leading: "leadership",
    risk: "risk-tolerance",
  };
  function normaliseTerm(t) {
    const trimmed = t.trim();
    return SYNONYMS[trimmed] || trimmed;
  }
  const likeDislike = q.match(/enjoy ([a-z\s-]+?) but (?:dislike|don't like|do not like|hate) ([a-z\s-]+)/);
  if (likeDislike) {
    const liked = normaliseTerm(likeDislike[1]);
    const disliked = normaliseTerm(likeDislike[2]);
    const scoringProfile = buildScoringProfile(profile.subjectIds, profile.workStyle);
    const scored = scoreAllCareers(scoringProfile).filter((s) => {
      const text = `${s.career.skills.join(" ")} ${s.career.interests.join(" ")} ${s.career.title}`.toLowerCase();
      return !text.includes(disliked);
    });
    const top = pickDiverse(scored, 1)[0];
    if (!top) return { answer: `I couldn't find a career matching "${liked}" while avoiding "${disliked}" -- try rephrasing.`, highlight: [] };
    const course = courseForCareer(top.career);
    const path = course
      ? describePath([ROOT, nid("qualification-stage", "gcse"), nid("qualification-stage", "a-level"), nid("qualification-stage", "degree"), nid("course", course.id), nid("career", top.career.id)], top.career.title, "#3B6EA5")
      : null;
    return {
      answer: `If you enjoy ${liked} but want to avoid ${disliked}, ${top.career.title} is a strong fit -- ${top.career.outlook}`,
      highlight: path ? [path] : [],
    };
  }

  // Fallback
  return {
    answer:
      "I can answer things like: \"What if I don't go to university?\", \"Can I become a software engineer without A-Levels?\", \"What if I switch from Biology to Chemistry?\", \"Which universities are realistic for AAB?\", or \"What careers are growing fastest?\" -- try one of those.",
    highlight: [],
  };
}

module.exports = {
  generateFutures,
  answerQuestion,
  subjectOptions,
  workStyleOptions,
  WORK_STYLES,
};
