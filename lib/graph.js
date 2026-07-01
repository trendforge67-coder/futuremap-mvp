// Unified Future Map graph engine.
//
// lib/pathways.js (Phase 1) exposed point lookups (subject -> courses,
// course -> universities, etc.) tailored to specific explorer screens.
// This module builds one single typed node/edge graph out of the same data
// files so the frontend can render the whole "Future Map" -- subjects,
// qualifications, apprenticeships, certifications, life-stages, courses,
// universities, industries, careers, and career-stages -- as one explorable,
// branching structure, instead of a flat per-career roadmap.
//
// Nothing here mutates or replaces lib/pathways.js; the existing explorer
// routes keep using that module untouched. This is purely additive.

const fs = require("fs");
const path = require("path");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", file), "utf-8"));
}

const SUBJECTS = loadJson("subjects.json");
const QUALIFICATIONS = loadJson("qualifications.json");
const COURSES = loadJson("courses.json");
const UNIVERSITIES = loadJson("universities.json");
const CAREERS = loadJson("careers.json");
const INDUSTRIES = loadJson("industries.json");

// ---- node id namespacing -----------------------------------------------
// Different source files can reuse the same short id (e.g. a subject and a
// course both called "computer-science"), so every node gets a namespaced
// graph id of the form "<type>:<rawId>" to stay unique.
const nid = (type, rawId) => `${type}:${rawId}`;

function buildGraph() {
  const nodes = new Map();
  const edges = [];

  function addNode(type, rawId, label, data) {
    const id = nid(type, rawId);
    if (!nodes.has(id)) {
      nodes.set(id, { id, type, rawId, label, ...data });
    }
    return id;
  }

  function addEdge(fromId, toId, relation = "leads-to") {
    if (!fromId || !toId || fromId === toId) return;
    edges.push({ from: fromId, to: toId, relation });
  }

  // 1. Root entry point -- everyone starts here.
  const rootId = addNode("start", "start", "Start: Age 14-16", {
    description: "Pick the subjects you're studying now, or jump straight into a qualification stage, course, or career to explore outward from there.",
  });

  // 2. Subjects, linked from the root and into the qualification ladder.
  SUBJECTS.forEach((s) => {
    const sId = addNode("subject", s.id, s.name, {
      category: s.category,
      levels: s.levels,
      relatedSkills: s.relatedSkills,
    });
    addEdge(rootId, sId, "choose");
    // A subject leads into whichever qualification stages it's taken at.
    (s.levels || []).forEach((levelId) => {
      const qual = QUALIFICATIONS.find((q) => q.id === levelId);
      if (qual) addEdge(sId, nid("qualification-stage", qual.id), "studied-at");
    });
  });

  // 3. Qualification ladder (GCSE -> A-Level/Apprenticeship/... -> ... -> Senior Role).
  // Every entry becomes a node typed by its own nodeType (qualification,
  // apprenticeship, certification, life-stage, or career-stage) so the
  // frontend can colour/group them, while still living on one ladder.
  QUALIFICATIONS.forEach((q) => {
    addNode("qualification-stage", q.id, q.name, {
      nodeType: q.nodeType || "qualification",
      stage: q.stage,
      typicalAge: q.typicalAge,
      description: q.description,
    });
  });
  QUALIFICATIONS.forEach((q) => {
    const fromId = nid("qualification-stage", q.id);
    (q.nextIds || []).forEach((nextId) => addEdge(fromId, nid("qualification-stage", nextId), "progresses-to"));
  });
  // GCSEs are reachable directly from the root too, for students who want to
  // skip straight to "what comes after GCSEs" without picking subjects first.
  addEdge(rootId, nid("qualification-stage", "gcse"), "progresses-to");

  // 4. Courses, linked from the qualification stages that lead to a degree,
  // from the subjects required to get in, and out to the universities that
  // offer them and the careers they lead to.
  COURSES.forEach((c) => {
    const cId = addNode("course", c.id, c.title, {
      category: c.category,
      whatYouLearn: c.whatYouLearn,
      skillsGained: c.skillsGained,
      avgSalaryGraduate: c.avgSalaryGraduate,
      demand: c.demand,
      difficulty: c.difficulty,
      durationYears: c.durationYears,
      typicalModules: c.typicalModules,
    });

    ["degree", "degree-apprenticeship", "foundation-year"].forEach((stageId) =>
      addEdge(nid("qualification-stage", stageId), cId, "can-study")
    );

    (c.requiredSubjectIds || []).forEach((subjId) => addEdge(nid("subject", subjId), cId, "required-for"));
    (c.altSubjectIds || []).forEach((subjId) => addEdge(nid("subject", subjId), cId, "alt-route-to"));
    (c.alternativeCourseIds || []).forEach((altId) => addEdge(cId, nid("course", altId), "alternative-to"));
    (c.careerIds || []).forEach((careerId) => addEdge(cId, nid("career", careerId), "leads-to"));
  });

  // 5. Universities, linked from the courses they offer.
  UNIVERSITIES.forEach((u) => {
    const uId = addNode("university", u.id, u.name, {
      locationId: u.locationId,
      overallRanking: u.overallRanking,
      offerings: u.offerings,
    });
    (u.offerings || []).forEach((o) => addEdge(nid("course", o.courseId), uId, "offered-by"));
  });

  // 6. Industries, derived from career categories -- gives "industry" its
  // own browsable node instead of a hidden string field.
  INDUSTRIES.forEach((i) => {
    addNode("industry", i.id, i.name, { description: i.description, outlook: i.outlook });
  });

  // 7. Careers, linked into their industry and forward into the
  // graduate-job / senior-role career-stage nodes, plus a specialisation
  // leaf so every career terminates in a concrete "where this ends up" node.
  CAREERS.forEach((c) => {
    const cId = addNode("career", c.id, c.title, {
      outlook: c.outlook,
      earningsRange: c.earningsRange,
      growthScore: c.growthScore,
      riskScore: c.riskScore,
      riskNote: c.riskNote,
      entrepreneurial: !!c.entrepreneurial,
    });

    if (c.category && nodes.has(nid("industry", c.category))) {
      addEdge(cId, nid("industry", c.category), "belongs-to");
    }

    addEdge(cId, nid("qualification-stage", "graduate-job"), "entered-via");
    if (c.entrepreneurial) addEdge(nid("qualification-stage", "startup"), cId, "alt-route-to");

    const specId = addNode("specialisation", `${c.id}-senior`, `Senior ${c.title}`, {
      careerId: c.id,
      earningsRange: c.earningsRange,
      description: `Established, specialised practice in ${c.title.toLowerCase()} -- typically 8-10+ years in.`,
    });
    addEdge(cId, specId, "specialises-into");
    addEdge(nid("qualification-stage", "senior-role"), specId, "progresses-to");
  });

  return {
    nodes: [...nodes.values()],
    edges,
    rootId,
  };
}

// Build once at module load -- the dataset is small (~120 nodes) and static
// for the life of the process, so there's no benefit to rebuilding per request.
const GRAPH = buildGraph();

function getNode(id) {
  return GRAPH.nodes.find((n) => n.id === id) || null;
}

// BFS outward from a node up to `depth` hops, following edges in either
// direction -- used if a future "expand from here" endpoint is needed.
// Not currently called by any route (the whole graph is small enough to
// send in one response), but kept here since the frontend's expand/collapse
// interaction maps directly onto this traversal if we ever need to lazy-load.
function neighbourhood(nodeId, depth = 1) {
  const visited = new Set([nodeId]);
  let frontier = [nodeId];
  const subEdges = [];

  for (let step = 0; step < depth; step++) {
    const next = [];
    GRAPH.edges.forEach((e) => {
      if (frontier.includes(e.from) && !visited.has(e.to)) {
        visited.add(e.to);
        next.push(e.to);
        subEdges.push(e);
      } else if (frontier.includes(e.to) && !visited.has(e.from)) {
        visited.add(e.from);
        next.push(e.from);
        subEdges.push(e);
      } else if (frontier.includes(e.from) && frontier.includes(e.to)) {
        subEdges.push(e);
      }
    });
    frontier = next;
  }

  return {
    nodes: GRAPH.nodes.filter((n) => visited.has(n.id)),
    edges: subEdges,
  };
}

module.exports = { GRAPH, getNode, neighbourhood, nid };
