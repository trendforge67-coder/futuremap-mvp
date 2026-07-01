const SUBJECTS = ["Maths", "Further Maths", "Computer Science", "Physics", "Chemistry", "Biology", "English", "History", "Business", "Economics", "Art", "Design Technology", "Psychology", "Media Studies"];
const INTERESTS = ["technology", "business", "science", "creativity", "helping-others", "maths", "design", "psychology", "gaming", "writing", "problem-solving", "communication"];
const SKILLS = ["maths", "programming", "problem-solving", "logic", "communication", "creativity", "leadership", "resilience", "risk-tolerance"];
const GOALS = [
  { id: "high-income", label: "High income" },
  { id: "stability", label: "Stability" },
  { id: "build-a-startup", label: "Build a startup" },
  { id: "make-an-impact", label: "Make an impact" },
  { id: "flexibility", label: "Flexibility / remote work" },
  { id: "creative-work", label: "Creative work" },
];

const selected = { subjects: new Set(), interests: new Set(), skills: new Set(), goals: new Set() };

function renderChips(containerId, items, groupKey, getId = (x) => x, getLabel = (x) => x) {
  const el = document.getElementById(containerId);
  items.forEach((item) => {
    const id = getId(item);
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = getLabel(item);
    chip.onclick = () => {
      if (selected[groupKey].has(id)) {
        selected[groupKey].delete(id);
        chip.classList.remove("selected");
      } else {
        selected[groupKey].add(id);
        chip.classList.add("selected");
      }
    };
    el.appendChild(chip);
  });
}

renderChips("subjects-group", SUBJECTS, "subjects");
renderChips("interests-group", INTERESTS, "interests");
renderChips("skills-group", SKILLS, "skills");
renderChips("goals-group", GOALS, "goals", (g) => g.id, (g) => g.label);

function riskClass(score) {
  if (score >= 0.6) return "high";
  if (score <= 0.3) return "low";
  return "mid";
}

function pathCardHtml(p) {
  const subjectsTags = p.requiredSubjects.map((s) => `<span class="tag">${s}</span>`).join("");
  const missingNote = p.missingSubjects && p.missingSubjects.length
    ? `<p class="muted">Not yet confirmed: ${p.missingSubjects.join(", ")}</p>` : "";
  const roadmapHtml = p.narrative.roadmap
    .map((r) => `<div class="node${r.type ? ` node-${r.type}` : ""}"><div class="age">Age ${r.age}</div><div class="milestone">${r.milestone}</div></div>`)
    .join("");

  return `
  <div class="path-card">
    <h3><span class="rank-badge">${p.rank}</span>${p.title}</h3>
    <div class="fit-bar-track"><div class="fit-bar-fill" style="width:${p.fitPercent}%"></div></div>
    <p class="muted">${p.fitPercent}% fit to your profile</p>
    <p>${p.narrative.rationale}</p>
    <p>${subjectsTags}</p>
    ${missingNote}
    <p class="muted">${p.narrative.subjectsNote}</p>
    <p><strong>University/route options:</strong> ${p.universityRoutes.join(", ")}</p>
    <p><strong>Outlook:</strong> ${p.outlook}</p>
    <p><strong>Indicative earnings:</strong> ${p.earningsRange}</p>
    <p><span class="tag risk-tag ${riskClass(p.riskScore)}">Risk: ${riskClass(p.riskScore)}</span> ${p.narrative.riskNote}</p>
    <div class="roadmap">${roadmapHtml}</div>
    <button class="ghost life-sim-trigger" data-path-id="${p.id}" data-path-title="${p.title}">Simulate my whole life on this path &rarr;</button>
    <div class="life-sim-slot" id="life-sim-${p.id}"></div>
  </div>`;
}

let LOCATIONS_CACHE = null;
async function getLocations() {
  if (LOCATIONS_CACHE) return LOCATIONS_CACHE;
  const res = await fetch("/api/locations");
  const data = await res.json();
  LOCATIONS_CACHE = data.locations;
  return LOCATIONS_CACHE;
}

function lifeFormHtml(pathId, locations) {
  const opts = locations.map((l) => `<option value="${l.id}">${l.label}</option>`).join("");
  return `
  <div class="card life-form">
    <label>Where do you picture living?</label>
    <select class="life-location">${opts}</select>
    <label>Lifestyle</label>
    <select class="life-lifestyle">
      <option value="frugal">Frugal -- save aggressively</option>
      <option value="balanced" selected>Balanced</option>
      <option value="spender">Enjoy life now, save less</option>
    </select>
    <label>Partner with an income?</label>
    <select class="life-partner">
      <option value="no">No / not yet</option>
      <option value="yes">Yes</option>
    </select>
    <label>Kids? (ages you'd have them, comma separated, optional)</label>
    <input type="text" class="life-kids" placeholder="e.g. 30, 33" />
    <label>Target retirement age</label>
    <input type="number" class="life-retire" value="67" min="50" max="75" />
    <button class="primary life-run-btn" data-path-id="${pathId}">Run life simulation</button>
    <div class="life-result"></div>
  </div>`;
}

function lifeResultHtml(sim) {
  const rows = sim.timeline
    .map(
      (t) => `<div class="node"><div class="age">Age ${t.age}</div><div class="milestone">£${t.grossIncome.toLocaleString()} income${t.ownsHome ? " &middot; owns home" : ""}<br>Savings: £${t.savings.toLocaleString()}</div></div>`
    )
    .join("");
  const risks = sim.narrative.riskLines.map((r) => `<li>${r}</li>`).join("");

  return `
    <p><strong>${sim.narrative.headline}</strong></p>
    <p>${sim.narrative.homeLine}</p>
    <p>${sim.narrative.retirementLine}</p>
    <p class="muted"><strong>Notes:</strong></p>
    <ul class="muted">${risks}</ul>
    <div class="roadmap">${rows}</div>
    <p class="muted" style="margin-top:10px;"><em>${sim.narrative.disclaimer}</em></p>
  `;
}

document.addEventListener("click", async (e) => {
  const trigger = e.target.closest(".life-sim-trigger");
  if (trigger) {
    const pathId = trigger.dataset.pathId;
    const slot = document.getElementById(`life-sim-${pathId}`);
    if (slot.dataset.open === "true") {
      slot.innerHTML = "";
      slot.dataset.open = "false";
      return;
    }
    const locations = await getLocations();
    slot.innerHTML = lifeFormHtml(pathId, locations);
    slot.dataset.open = "true";
    return;
  }

  const runBtn = e.target.closest(".life-run-btn");
  if (runBtn) {
    const pathId = runBtn.dataset.pathId;
    const formEl = runBtn.closest(".life-form");
    const body = {
      careerId: pathId,
      locationId: formEl.querySelector(".life-location").value,
      lifestyle: formEl.querySelector(".life-lifestyle").value,
      hasPartner: formEl.querySelector(".life-partner").value === "yes",
      kidsAt: formEl
        .querySelector(".life-kids")
        .value.split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n)),
      retirementAgeTarget: parseInt(formEl.querySelector(".life-retire").value, 10) || 67,
    };
    const resultEl = formEl.querySelector(".life-result");
    resultEl.innerHTML = `<p class="muted">Simulating...</p>`;
    try {
      const res = await fetch("/api/simulate-life", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const sim = await res.json();
      if (sim.error) throw new Error(sim.detail || sim.error);
      resultEl.innerHTML = lifeResultHtml(sim);
    } catch (err) {
      resultEl.innerHTML = `<p class="muted">Something went wrong: ${err.message}</p>`;
    }
  }
});

async function generate() {
  const profile = {
    age: Number(document.getElementById("age").value),
    subjects: [...selected.subjects],
    interests: [...selected.interests],
    skills: [...selected.skills],
    goals: [...selected.goals],
  };

  document.getElementById("loading").style.display = "block";
  document.getElementById("generate-btn").disabled = true;

  try {
    const res = await fetch("/api/generate-paths", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    renderResults(data, profile);
  } catch (e) {
    document.getElementById("results").innerHTML = `<p class="muted">Something went wrong: ${e.message}</p>`;
  } finally {
    document.getElementById("loading").style.display = "none";
    document.getElementById("generate-btn").disabled = false;
  }
}

function renderResults(data, profile) {
  const el = document.getElementById("results");
  el.style.display = "block";
  el.innerHTML = `<h2>Your top ${data.paths.length} future paths</h2>` + data.paths.map(pathCardHtml).join("") +
    `<div class="card what-if-box">
      <strong>Career Simulator</strong>
      <p class="muted">Try "what if" you leaned harder into a specific skill or goal -- re-runs the same engine with a tweak.</p>
      <select id="whatif-goal">
        <option value="">-- add a goal and re-simulate --</option>
        ${GOALS.map((g) => `<option value="${g.id}">${g.label}</option>`).join("")}
      </select>
      <button class="primary" id="whatif-btn">Re-simulate</button>
      <div id="whatif-results"></div>
    </div>`;

  document.getElementById("whatif-btn").onclick = async () => {
    const goal = document.getElementById("whatif-goal").value;
    if (!goal) return;
    const whatIf = { goals: [...profile.goals, goal] };
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile, whatIf }),
    });
    const data = await res.json();
    document.getElementById("whatif-results").innerHTML =
      `<h4>If you also prioritise "${goal.replace(/-/g, " ")}":</h4>` + data.paths.map(pathCardHtml).join("");
  };
}

document.getElementById("generate-btn").addEventListener("click", generate);

// ===================== Tabs =====================
document.getElementById("main-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

  if (btn.dataset.tab === "subjects" && !subjectsLoaded) loadSubjectExplorer();
  if (btn.dataset.tab === "courses" && !coursesLoaded) loadCourseExplorer();
  if (btn.dataset.tab === "compare" && !compareLoaded) loadCompare();
  document.body.classList.toggle("futuremap-active", btn.dataset.tab === "futuremap");
  if (btn.dataset.tab === "futuremap") {
    window.FutureMapGraph.init("future-map-canvas", "graph-detail-panel", "graph-legend");
  }
});

document.getElementById("graph-reset-btn").addEventListener("click", () => {
  window.FutureMapGraph.resetView();
});

// ===================== Subject Explorer =====================
let subjectsLoaded = false;
let SUBJECTS_DATA = [];

async function loadSubjectExplorer() {
  subjectsLoaded = true;
  const res = await fetch("/api/subjects");
  const data = await res.json();
  SUBJECTS_DATA = data.subjects;
  const el = document.getElementById("subject-explore-chips");
  SUBJECTS_DATA.forEach((s) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = s.name;
    chip.onclick = async () => {
      document.querySelectorAll("#subject-explore-chips .chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      const r = await fetch(`/api/subjects/${s.id}/explore`);
      const detail = await r.json();
      renderSubjectExplore(detail);
    };
    el.appendChild(chip);
  });
}

function renderSubjectExplore(detail) {
  const el = document.getElementById("subject-explore-results");
  if (!detail.courses.length) {
    el.innerHTML = `<p class="muted">No mapped courses yet for ${detail.subject.name}.</p>`;
    return;
  }
  el.innerHTML = `<h2>${detail.subject.name} unlocks ${detail.courses.length} course${detail.courses.length > 1 ? "s" : ""}</h2>` +
    detail.courses.map((c) => `
      <div class="path-card">
        <h3>${c.title}</h3>
        <p class="muted">${c.whatYouLearn}</p>
        <p><strong>Leads to:</strong> ${c.careers.map((cr) => cr.title).join(", ") || "Many adjacent roles"}</p>
        <p><strong>Top universities:</strong> ${c.universities.map((u) => u.universityName).join(", ") || "See Explore Courses tab"}</p>
      </div>
    `).join("");
}

// ===================== Course Explorer =====================
let coursesLoaded = false;
let COURSES_DATA = [];

async function loadCourseExplorer() {
  coursesLoaded = true;
  const res = await fetch("/api/courses");
  const data = await res.json();
  COURSES_DATA = data.courses;
  const el = document.getElementById("course-explore-chips");
  COURSES_DATA.forEach((c) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = c.title;
    chip.onclick = async () => {
      document.querySelectorAll("#course-explore-chips .chip").forEach((ch) => ch.classList.remove("selected"));
      chip.classList.add("selected");
      const r = await fetch(`/api/courses/${c.id}/explore`);
      const detail = await r.json();
      renderCourseExplore(detail);
    };
    el.appendChild(chip);
  });
}

function renderCourseExplore(detail) {
  const el = document.getElementById("course-explore-results");
  const c = detail.course;
  const modules = c.typicalModules.map((m) => `<span class="tag">${m}</span>`).join("");
  const reqSubjects = detail.requiredSubjects.map((s) => `<span class="tag">${s.name}</span>`).join("");
  const altSubjects = detail.altSubjects.map((s) => `<span class="tag">${s.name}</span>`).join("");
  const careers = detail.careers.map((cr) => `<span class="tag">${cr.title}</span>`).join("");
  const altCourses = detail.alternativeCourses.map((ac) => `<span class="tag">${ac.title}</span>`).join("");
  const unis = detail.universities.map((u) => `
    <div class="node">
      <div class="age">#${u.overallRanking ?? "--"}</div>
      <div class="milestone">${u.universityName}<br>${u.typicalGrades} &middot; ${u.ucasPoints} UCAS pts &middot; £${u.tuitionFeePerYear.toLocaleString()}/yr<br>Employability: ${Math.round(u.employabilityRate * 100)}%</div>
    </div>
  `).join("");

  el.innerHTML = `
    <div class="path-card">
      <h3>${c.title}</h3>
      <p class="muted">${c.whatYouLearn}</p>
      <p><strong>Duration:</strong> ${c.durationYears} years &middot; <strong>Demand:</strong> ${c.demand} &middot; <strong>Difficulty:</strong> ${c.difficulty} &middot; <strong>Avg graduate salary:</strong> £${c.avgSalaryGraduate.toLocaleString()}</p>
      <p><strong>Typical modules:</strong></p><p>${modules}</p>
      <p><strong>Required subjects:</strong> ${reqSubjects || "<span class=\"muted\">none specified</span>"}</p>
      ${altSubjects ? `<p><strong>Alternative subjects:</strong> ${altSubjects}</p>` : ""}
      <p><strong>Leads to careers:</strong> ${careers}</p>
      ${altCourses ? `<p><strong>Alternative courses to consider:</strong> ${altCourses}</p>` : ""}
      <p><strong>Universities offering this course:</strong></p>
      <div class="roadmap">${unis || '<span class="muted">No sample universities mapped yet.</span>'}</div>
    </div>
  `;
}

// ===================== Compare =====================
let compareLoaded = false;
const compareSelected = new Set();

async function loadCompare() {
  compareLoaded = true;
  document.getElementById("compare-type").addEventListener("change", renderCompareChips);
  await renderCompareChips();
  document.getElementById("compare-btn").addEventListener("click", runCompare);
}

async function renderCompareChips() {
  compareSelected.clear();
  const type = document.getElementById("compare-type").value;
  const el = document.getElementById("compare-chips");
  el.innerHTML = "";

  let items = [];
  if (type === "course") {
    if (!COURSES_DATA.length) COURSES_DATA = (await (await fetch("/api/courses")).json()).courses;
    items = COURSES_DATA.map((c) => ({ id: c.id, label: c.title }));
  } else if (type === "career") {
    const data = await (await fetch("/api/careers")).json();
    items = data.careersDetailed.map((c) => ({ id: c.id, label: c.title }));
  } else if (type === "university") {
    const data = await (await fetch("/api/universities")).json();
    items = data.universities.map((u) => ({ id: u.id, label: u.name }));
  }

  items.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = item.label;
    chip.onclick = () => {
      if (compareSelected.has(item.id)) {
        compareSelected.delete(item.id);
        chip.classList.remove("selected");
      } else {
        compareSelected.add(item.id);
        chip.classList.add("selected");
      }
    };
    el.appendChild(chip);
  });
}

async function runCompare() {
  const type = document.getElementById("compare-type").value;
  const ids = [...compareSelected];
  const el = document.getElementById("compare-results");
  if (ids.length < 2) {
    el.innerHTML = `<p class="muted">Pick at least two to compare.</p>`;
    return;
  }
  const res = await fetch(`/api/compare?type=${type}&ids=${ids.join(",")}`);
  const data = await res.json();
  if (!data.items.length) {
    el.innerHTML = `<p class="muted">No data found for that comparison.</p>`;
    return;
  }
  const keys = Object.keys(data.items[0]).filter((k) => k !== "id");
  const rows = keys.map((k) => `
    <tr><td class="compare-key">${k}</td>${data.items.map((it) => `<td>${Array.isArray(it[k]) ? it[k].join(", ") : it[k]}</td>`).join("")}</tr>
  `).join("");
  el.innerHTML = `
    <table class="compare-table">
      <thead><tr><th></th>${data.items.map((it) => `<th>${it.title || it.name}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
