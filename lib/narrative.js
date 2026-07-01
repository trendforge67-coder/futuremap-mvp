// Narrative layer: turns scored/ranked paths into plain-language rationale.
// Per the blueprint's AI architecture: the LLM (or here, a template fallback)
// NEVER invents numbers -- every figure shown comes straight from the scoring
// engine / data file, never from free generation. This file only writes the
// connective sentences around facts that are already computed.
//
// Swap `templateNarrative` for a real LLM call by setting ANTHROPIC_API_KEY
// and implementing `llmNarrative()` below -- the call site (server.js) already
// supports both; it just prefers the LLM when the key is present.

const { buildConnectedRoadmap } = require("./pathways.js");

function templateNarrative(profile, path) {
  const why = [];
  if (path.interestScore >= 50) why.push("strong overlap with your stated interests");
  if (path.skillScore >= 50) why.push("matches the skills you already rate yourself highly on");
  if (path.goalHits.length) why.push(path.goalHits.join(" and "));
  if (!why.length) why.push("a realistic adjacent option worth knowing about, even if it's not your closest match");

  const subjectsLine = path.missingSubjects && path.missingSubjects.length
    ? `You haven't yet confirmed ${path.missingSubjects.join(", ")} -- worth checking before ruling this in or out.`
    : `Your subject choices already line up with what this path typically needs.`;

  const riskLine = path.riskScore >= 0.6
    ? `Treat this as higher-variance: ${path.riskNote}`
    : path.riskScore <= 0.3
    ? `This is a relatively low-volatility path: ${path.riskNote}`
    : `Moderate risk: ${path.riskNote}`;

  return {
    rationale: `Ranked #${path.rank} because of ${why.join(", ")}.`,
    subjectsNote: subjectsLine,
    riskNote: riskLine,
    roadmap: buildRoadmap(profile, path),
  };
}

// Richer, connected roadmap: Subject -> Qualification -> Course -> University -> Career,
// instead of a single flat "career roadmap". Falls back to the original 5-point
// roadmap shape if the connected graph has nothing extra to add, so existing
// frontend rendering keeps working unchanged.
function buildRoadmap(profile, path) {
  const startAge = profile.age || 15;
  const connected = buildConnectedRoadmap(profile, path, startAge);
  if (connected && connected.length) return connected;

  return [
    { age: startAge, milestone: `Confirm subjects: ${path.requiredSubjects.join(", ")}${path.altSubjects?.length ? ` (or ${path.altSubjects.join("/")})` : ""}` },
    { age: startAge + 2, milestone: `A-Levels / next qualification stage aligned to ${path.title}` },
    { age: startAge + 3, milestone: `University/route: ${path.universityRoutes[0]}` },
    { age: startAge + 6, milestone: `First role or placement in or adjacent to ${path.title}` },
    { age: startAge + 10, milestone: `Established in ${path.title} -- indicative earnings ${path.earningsRange}` },
  ];
}

// --- LLM hook (optional, off by default) ---------------------------------
async function llmNarrative(profile, path) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return templateNarrative(profile, path);

  const factsOnly = {
    rank: path.rank,
    title: path.title,
    interestScore: path.interestScore,
    skillScore: path.skillScore,
    goalHits: path.goalHits,
    requiredSubjects: path.requiredSubjects,
    missingSubjects: path.missingSubjects,
    earningsRange: path.earningsRange,
    riskScore: path.riskScore,
    riskNote: path.riskNote,
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content:
              "You write one short, calm, plain-language paragraph explaining why a career path was recommended to a teenager. " +
              "ONLY use the facts given below -- never invent a number, statistic, or claim not present in the JSON. " +
              "Do not state probabilities or guarantees. Facts:\n" +
              JSON.stringify(factsOnly),
          },
        ],
      }),
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (!text) return templateNarrative(profile, path);
    const fallback = templateNarrative(profile, path);
    return { ...fallback, rationale: text.trim() };
  } catch (e) {
    return templateNarrative(profile, path);
  }
}

module.exports = { templateNarrative, llmNarrative, buildRoadmap };
