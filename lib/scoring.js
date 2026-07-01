// Rules-based ranking engine for the Future Path Generator.
// Deliberately NOT an LLM — scoring/ranking must stay deterministic and explainable.
// The LLM layer (lib/narrative.js) only narrates the output of this module.

const fs = require("fs");
const path = require("path");

const CAREERS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "careers.json"), "utf-8")
);

const GOAL_WEIGHTS = {
  "high-income": { growthScore: 0.5, earningsBias: 0.5 },
  "stability": { riskScoreInverse: 0.7, growthScore: 0.3 },
  "build-a-startup": { entrepreneurial: 1.0 },
  "make-an-impact": { categoryBoost: ["medicine", "education", "healthcare", "science"] },
  "flexibility": { categoryBoost: ["tech", "design-tech", "tech-creative", "business-tech"] },
  "creative-work": { categoryBoost: ["design", "design-tech", "tech-creative", "media"] },
};

function overlapScore(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b.map((x) => x.toLowerCase()));
  const hits = a.filter((x) => setB.has(x.toLowerCase())).length;
  return hits / Math.max(a.length, 1);
}

function subjectGateCheck(profile, career) {
  // "Hard gate" subjects the student has explicitly ruled out / doesn't have.
  const taken = new Set((profile.subjects || []).map((s) => s.toLowerCase()));
  const required = career.requiredSubjects || [];
  if (!required.length) return { blocked: false, missing: [] };
  const missing = required.filter((s) => !taken.has(s.toLowerCase()));
  // Only "block" if the student has actively confirmed final subjects (post-GCSE/A-Level)
  // and is missing ALL required subjects — otherwise it's just a flag, not a hard block.
  const blocked = profile.subjectsFinal === true && missing.length === required.length;
  return { blocked, missing };
}

function scoreCareer(profile, career) {
  const interestScore = overlapScore(profile.interests, career.interests);
  const skillScore = overlapScore(profile.skills, career.skills);

  let goalScore = 0;
  let goalHits = [];
  (profile.goals || []).forEach((goal) => {
    const w = GOAL_WEIGHTS[goal];
    if (!w) return;
    if (w.growthScore) goalScore += career.growthScore * w.growthScore;
    if (w.riskScoreInverse) goalScore += (1 - career.riskScore) * w.riskScoreInverse;
    if (w.entrepreneurial && career.entrepreneurial) {
      goalScore += 1.0;
      goalHits.push("entrepreneurial fit");
    }
    if (w.categoryBoost && w.categoryBoost.includes(career.category)) {
      goalScore += 0.6;
      goalHits.push(`matches goal: ${goal}`);
    }
    if (w.earningsBias) goalScore += career.growthScore * w.earningsBias * 0.5;
  });

  const gate = subjectGateCheck(profile, career);

  // Weighted composite. Interests and skills matter most; goals add a secondary boost.
  const fit = 0.4 * interestScore + 0.35 * skillScore + 0.25 * Math.min(goalScore, 1.5) / 1.5;

  return {
    career,
    fitRaw: fit,
    interestScore,
    skillScore,
    goalScore,
    goalHits,
    blocked: gate.blocked,
    missingSubjects: gate.missing,
  };
}

// Select top 5 maximising BOTH fit and diversity (category spread + risk spread),
// not just the 5 highest raw scores -- a pure top-5-by-score list tends to return
// near-duplicate paths in the same category.
function selectDiverseTop5(scored) {
  const sorted = [...scored].sort((a, b) => b.fitRaw - a.fitRaw);
  const chosen = [];
  const usedCategories = new Set();

  for (const item of sorted) {
    if (chosen.length >= 5) break;
    if (usedCategories.has(item.career.category) && chosen.length < 4) {
      continue; // prefer a new category until we're close to filling the list
    }
    chosen.push(item);
    usedCategories.add(item.career.category);
  }
  // Backfill if categories were too strict and we didn't reach 5
  for (const item of sorted) {
    if (chosen.length >= 5) break;
    if (!chosen.includes(item)) chosen.push(item);
  }
  return chosen.slice(0, 5);
}

function generatePaths(profile) {
  const candidates = CAREERS.filter((c) => {
    const gate = subjectGateCheck(profile, c);
    return !gate.blocked;
  });

  const scored = candidates.map((c) => scoreCareer(profile, c));
  const top5 = selectDiverseTop5(scored);

  return top5.map((s, i) => ({
    rank: i + 1,
    id: s.career.id,
    title: s.career.title,
    fitPercent: Math.round(Math.min(s.fitRaw, 1) * 100),
    interestScore: Math.round(s.interestScore * 100),
    skillScore: Math.round(s.skillScore * 100),
    goalHits: s.goalHits,
    requiredSubjects: s.career.requiredSubjects,
    altSubjects: s.career.altSubjects,
    missingSubjects: s.missingSubjects,
    universityRoutes: s.career.universityRoutes,
    outlook: s.career.outlook,
    earningsRange: s.career.earningsRange,
    growthScore: s.career.growthScore,
    riskScore: s.career.riskScore,
    riskNote: s.career.riskNote,
    entrepreneurial: s.career.entrepreneurial,
    subjectIds: s.career.subjectIds || [],
    courseIds: s.career.courseIds || [],
  }));
}

module.exports = { generatePaths, CAREERS, scoreCareer };
