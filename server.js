// FutureMap AI -- MVP server. Zero npm dependencies (Node core `http` only)
// so it runs anywhere with just `node server.js`. Swap this for Next.js/Express
// later -- the routes and modules underneath (lib/scoring.js, lib/narrative.js,
// lib/pathways.js) don't need to change.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { generatePaths, CAREERS } = require("./lib/scoring.js");
const { llmNarrative } = require("./lib/narrative.js");
const { simulateLife, LOCATIONS } = require("./lib/lifeSimulator.js");
const { buildLifeNarrative } = require("./lib/lifeNarrative.js");
const pathways = require("./lib/pathways.js");
const futureMapGraph = require("./lib/graph.js");
const futurePlanner = require("./lib/futurePlanner.js");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function send(res, status, body, contentType = "application/json") {
  res.writeHead(status, { "content-type": contentType });

  if (Buffer.isBuffer(body)) {
    return res.end(body);
  }

  if (typeof body === "string") {
    return res.end(body);
  }

  return res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: "not found" });
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const segments = pathname.split("/").filter(Boolean); // e.g. ["api","courses","law"]

  // ---- API: generate top-5 future paths from a profile ----
  if (pathname === "/api/generate-paths" && req.method === "POST") {
    try {
      const profile = await readJsonBody(req);
      const paths = generatePaths(profile);
      const withNarrative = await Promise.all(
        paths.map(async (p) => ({ ...p, narrative: await llmNarrative(profile, p) }))
      );
      return send(res, 200, { profile, paths: withNarrative });
    } catch (e) {
      console.error(e);
      return send(res, 400, { error: "invalid request", detail: String(e.message || e) });
    }
  }

  // ---- API: Career Simulator "what if" -- reuses the same scoring engine ----
  if (pathname === "/api/simulate" && req.method === "POST") {
    try {
      const { profile, whatIf } = await readJsonBody(req);
      // whatIf can tweak subjects/skills/goals before re-running the same engine --
      // this is the "what happens if I choose X instead of Y" mechanic.
      const tweakedProfile = { ...profile, ...whatIf };
      const paths = generatePaths(tweakedProfile);
      const withNarrative = await Promise.all(
        paths.slice(0, 3).map(async (p) => ({ ...p, narrative: await llmNarrative(tweakedProfile, p) }))
      );
      return send(res, 200, { tweakedProfile, paths: withNarrative });
    } catch (e) {
      console.error(e);
      return send(res, 400, { error: "invalid request", detail: String(e.message || e) });
    }
  }

  // ---- API: career taxonomy (for populating form checkboxes) ----
  // `careers` (titles only) kept for backward compatibility with the original
  // contract; `careersDetailed` adds ids so the frontend can link/compare reliably.
  if (pathname === "/api/careers" && req.method === "GET") {
    return send(res, 200, {
      count: CAREERS.length,
      careers: CAREERS.map((c) => c.title),
      careersDetailed: CAREERS.map((c) => ({ id: c.id, title: c.title })),
    });
  }

  // ---- API: locations (for populating the Life Simulator form) ----
  if (pathname === "/api/locations" && req.method === "GET") {
    return send(res, 200, { locations: LOCATIONS.map((l) => ({ id: l.id, label: l.label, note: l.note })) });
  }

  // ---- API: Life Simulator -- full-life trajectory for a chosen career path ----
  if (pathname === "/api/simulate-life" && req.method === "POST") {
    try {
      const input = await readJsonBody(req);
      const sim = simulateLife(input);
      const narrative = buildLifeNarrative(sim);
      return send(res, 200, { ...sim, narrative });
    } catch (e) {
      console.error(e);
      return send(res, 400, { error: "invalid request", detail: String(e.message || e) });
    }
  }

  // ===================== Pathways graph API (new) =====================
  // Subject <-> Qualification <-> Course <-> University <-> Career.
  // Lets the frontend offer Subject Explorer / Course Explorer / Compare
  // without the student ever having to pick a job title first.

  // GET /api/subjects -> list all subjects
  if (pathname === "/api/subjects" && req.method === "GET") {
    return send(res, 200, { subjects: pathways.SUBJECTS });
  }

  // GET /api/subjects/:id/explore -> subject -> courses -> careers fan-out
  if (segments[0] === "api" && segments[1] === "subjects" && segments[3] === "explore" && req.method === "GET") {
    const result = pathways.exploreFromSubject(segments[2]);
    if (!result) return send(res, 404, { error: "subject not found" });
    return send(res, 200, result);
  }

  // GET /api/courses -> list all courses (summary)
  if (pathname === "/api/courses" && req.method === "GET") {
    return send(res, 200, { courses: pathways.COURSES });
  }

  // GET /api/courses/:id/explore -> course detail with subjects, careers, unis
  if (segments[0] === "api" && segments[1] === "courses" && segments[3] === "explore" && req.method === "GET") {
    const result = pathways.exploreFromCourse(segments[2]);
    if (!result) return send(res, 404, { error: "course not found" });
    return send(res, 200, result);
  }

  // GET /api/universities -> list all universities with offerings
  if (pathname === "/api/universities" && req.method === "GET") {
    return send(res, 200, { universities: pathways.UNIVERSITIES });
  }

  // GET /api/universities?courseId=law -> universities offering one course, ranked
  if (pathname === "/api/universities-for-course" && req.method === "GET") {
    const courseId = searchParams.get("courseId");
    return send(res, 200, { courseId, universities: pathways.universitiesOfferingCourse(courseId) });
  }

  // GET /api/qualifications -> the qualification ladder (GCSE -> ... -> PhD)
  if (pathname === "/api/qualifications" && req.method === "GET") {
    return send(res, 200, { qualifications: pathways.QUALIFICATIONS });
  }

  // GET /api/compare?type=course&ids=law,business -> side-by-side rows
  if (pathname === "/api/compare" && req.method === "GET") {
    const type = searchParams.get("type");
    const ids = (searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
    return send(res, 200, { type, items: pathways.compare(type, ids) });
  }

  // ===================== Future Map graph API (Phase 2, new) =====================
  // One unified, typed node/edge graph -- subjects, qualification-ladder stages
  // (qualification/apprenticeship/certification/life-stage/career-stage),
  // courses, universities, industries, careers, and specialisations -- for the
  // interactive Future Map view. Read-only, additive; doesn't touch the
  // per-career roadmap or any Phase 1 explorer route.

  // GET /api/graph -> the whole graph in one response (small dataset, no
  // pagination needed). rootId tells the frontend where to centre the view.
  if (pathname === "/api/graph" && req.method === "GET") {
    return send(res, 200, {
      nodes: futureMapGraph.GRAPH.nodes,
      edges: futureMapGraph.GRAPH.edges,
      rootId: futureMapGraph.GRAPH.rootId,
    });
  }

  // GET /api/graph/node/:id -> single node detail, for the side panel.
  if (segments[0] === "api" && segments[1] === "graph" && segments[2] === "node" && segments[3] && req.method === "GET") {
    const node = futureMapGraph.getNode(decodeURIComponent(segments[3]));
    if (!node) return send(res, 404, { error: "node not found" });
    return send(res, 200, { node });
  }

  // ===================== AI Future Planner API (Phase 4, new) =====================
  // Conversational interview -> three real, graph-grounded "Futures", plus a
  // live Q&A box that re-queries the same deterministic engine. Nothing here
  // invents data: every path is built from lib/graph.js's real nodes/edges
  // and every number/title comes straight from data/*.json via lib/scoring.js.

  // GET /api/future-options -> interview option lists (subjects, work styles)
  if (pathname === "/api/future-options" && req.method === "GET") {
    return send(res, 200, {
      subjects: futurePlanner.subjectOptions(),
      workStyles: futurePlanner.workStyleOptions(),
    });
  }

  // POST /api/future-plan -> { subjectIds, workStyle } -> three Future paths
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

  // POST /api/future-qa -> { question, profile } -> answer + optional highlight path(s)
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

  // ---- Static files ----
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`FutureMap AI MVP running at http://localhost:${PORT}`);
  console.log(
    process.env.ANTHROPIC_API_KEY
      ? "LLM narrative layer: ON (ANTHROPIC_API_KEY detected)"
      : "LLM narrative layer: OFF -- using template narrative fallback (set ANTHROPIC_API_KEY to enable)"
  );
});
