// AI Future Planner -- frontend.
//
// Interview (subjects + work style) -> POST /api/future-plan -> three real,
// graph-grounded "Futures" rendered as cards, each with a "Show on map"
// button that switches to the Future Map tab and highlights that exact path
// (or all three at once, in distinct colours). The Q&A box below re-queries
// the same deterministic engine and can update the map live.
//
// Nothing here invents data -- every path/number rendered comes straight
// from the /api/future-plan and /api/future-qa responses, which are built
// from the real graph (lib/graph.js) and real career/subject data.

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

// Switches to the Future Map tab (reusing the same tab-click logic app.js
// already wires up) and lazily inits the canvas if this is the first visit,
// then hands the path(s) over to be drawn and animated.
function showFuturesOnMap(paths) {
  const mapTabBtn = document.querySelector('.tab-btn[data-tab="futuremap"]');
  if (mapTabBtn) mapTabBtn.click();
  // init() is a no-op (just a resize) if the canvas is already built, so
  // it's safe to call every time rather than tracking state here too.
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
