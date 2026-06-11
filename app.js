"use strict";

/* =========================================================
   DATA — 48 teams, 12 groups (A–L) of 4
   ========================================================= */
// Official groups from the December 2025 draw (playoff slots resolved March 2026)
const GROUPS = {
  A: [t("Mexico", "🇲🇽"), t("South Korea", "🇰🇷"), t("South Africa", "🇿🇦"), t("Czechia", "🇨🇿")],
  B: [t("Canada", "🇨🇦"), t("Switzerland", "🇨🇭"), t("Bosnia and Herzegovina", "🇧🇦"), t("Qatar", "🇶🇦")],
  C: [t("Brazil", "🇧🇷"), t("Morocco", "🇲🇦"), t("Scotland", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"), t("Haiti", "🇭🇹")],
  D: [t("USA", "🇺🇸"), t("Türkiye", "🇹🇷"), t("Australia", "🇦🇺"), t("Paraguay", "🇵🇾")],
  E: [t("Germany", "🇩🇪"), t("Ecuador", "🇪🇨"), t("Ivory Coast", "🇨🇮"), t("Curaçao", "🇨🇼")],
  F: [t("Netherlands", "🇳🇱"), t("Japan", "🇯🇵"), t("Sweden", "🇸🇪"), t("Tunisia", "🇹🇳")],
  G: [t("Belgium", "🇧🇪"), t("Iran", "🇮🇷"), t("Egypt", "🇪🇬"), t("New Zealand", "🇳🇿")],
  H: [t("Spain", "🇪🇸"), t("Uruguay", "🇺🇾"), t("Saudi Arabia", "🇸🇦"), t("Cape Verde", "🇨🇻")],
  I: [t("France", "🇫🇷"), t("Senegal", "🇸🇳"), t("Norway", "🇳🇴"), t("Iraq", "🇮🇶")],
  J: [t("Argentina", "🇦🇷"), t("Austria", "🇦🇹"), t("Algeria", "🇩🇿"), t("Jordan", "🇯🇴")],
  K: [t("Portugal", "🇵🇹"), t("Colombia", "🇨🇴"), t("Uzbekistan", "🇺🇿"), t("DR Congo", "🇨🇩")],
  L: [t("England", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"), t("Croatia", "🇭🇷"), t("Ghana", "🇬🇭"), t("Panama", "🇵🇦")],
};
const GROUP_KEYS = Object.keys(GROUPS);
// Round-robin matchdays for a group of 4 (indices into the group array)
const FIXTURE_PAIRS = [[0, 1], [2, 3], [0, 2], [3, 1], [0, 3], [1, 2]];
const TOTAL_GROUP_MATCHES = GROUP_KEYS.length * FIXTURE_PAIRS.length; // 72

const KO_ROUNDS = [
  { name: "Round of 32", size: 16 },
  { name: "Round of 16", size: 8 },
  { name: "Quarter-Finals", size: 4 },
  { name: "Semi-Finals", size: 2 },
  { name: "Final", size: 1 },
];
const FINAL_ROUND = KO_ROUNDS.length - 1;

function t(name, flag) { return { name, flag }; }

/* =========================================================
   STATE + PERSISTENCE
   ========================================================= */
const STORAGE_KEY = "wc2026-predictor-v2";

const defaultState = () => ({
  name: "",
  screen: "welcome",               // welcome | groups | knockout | celebration
  groupScores: {},                 // { "A-0": { h: 2, a: 1 } }
  koScores: {},                    // { "0-3": { h: 1, a: 1, pen: "h" } }
  bracketTeams: null,              // [[teamA, teamB] x 16] for the Round of 32
});

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  } catch {
    return defaultState();
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
}

/* =========================================================
   GROUP STAGE LOGIC
   ========================================================= */
function groupFixtures(gKey) {
  return FIXTURE_PAIRS.map((pair, i) => ({
    id: `${gKey}-${i}`,
    home: GROUPS[gKey][pair[0]],
    away: GROUPS[gKey][pair[1]],
  }));
}

function scoreComplete(s) {
  return s && Number.isInteger(s.h) && Number.isInteger(s.a) && s.h >= 0 && s.a >= 0;
}

function compareRows(a, b) {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.name.localeCompare(b.team.name);
}

function computeStandings(gKey) {
  const rows = GROUPS[gKey].map(team => ({ team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
  const byName = {};
  rows.forEach(r => { byName[r.team.name] = r; });

  for (const fx of groupFixtures(gKey)) {
    const s = state.groupScores[fx.id];
    if (!scoreComplete(s)) continue;
    const home = byName[fx.home.name];
    const away = byName[fx.away.name];
    home.p++; away.p++;
    home.gf += s.h; home.ga += s.a;
    away.gf += s.a; away.ga += s.h;
    if (s.h > s.a) { home.w++; away.l++; home.pts += 3; }
    else if (s.h < s.a) { away.w++; home.l++; away.pts += 3; }
    else { home.d++; away.d++; home.pts++; away.pts++; }
  }
  rows.forEach(r => { r.gd = r.gf - r.ga; });
  rows.sort(compareRows);
  return rows;
}

function groupComplete(gKey) {
  return groupFixtures(gKey).every(fx => scoreComplete(state.groupScores[fx.id]));
}

function predictedCount() {
  let n = 0;
  for (const gKey of GROUP_KEYS) {
    for (const fx of groupFixtures(gKey)) {
      if (scoreComplete(state.groupScores[fx.id])) n++;
    }
  }
  return n;
}

/* =========================================================
   ADVANCEMENT — top 2 of each group + 8 best 3rd places
   ========================================================= */
function buildBracketTeams() {
  const winners = [], runners = [], thirds = [];
  for (const gKey of GROUP_KEYS) {
    const table = computeStandings(gKey);
    winners.push({ ...table[0], group: gKey });
    runners.push({ ...table[1], group: gKey });
    thirds.push({ ...table[2], group: gKey });
  }
  // Best 3rd-placed sides ranked by Points, then GD, then GF
  winners.sort(compareRows);
  runners.sort(compareRows);
  thirds.sort(compareRows);
  const bestThirds = thirds.slice(0, 8);

  // Seeds 1–12: group winners, 13–24: runners-up, 25–32: best thirds
  const ranked = [...winners, ...runners, ...bestThirds];

  // Standard 32-seed single-elimination order so seeds 1 & 2 can only meet in the Final
  const order = seedOrder(32);
  const matches = [];
  for (let i = 0; i < 32; i += 2) {
    matches.push([ranked[order[i] - 1].team, ranked[order[i + 1] - 1].team]);
  }
  return matches;
}

function seedOrder(n) {
  let round = [1];
  while (round.length < n) {
    const sum = round.length * 2 + 1;
    const next = [];
    for (const s of round) next.push(s, sum - s);
    round = next;
  }
  return round;
}

/* =========================================================
   KNOCKOUT LOGIC
   ========================================================= */
function koTeams(r, m) {
  if (r === 0) return state.bracketTeams ? state.bracketTeams[m] : [null, null];
  return [koWinner(r - 1, m * 2), koWinner(r - 1, m * 2 + 1)];
}

function koWinner(r, m) {
  const [home, away] = koTeams(r, m);
  if (!home || !away) return null;
  const s = state.koScores[`${r}-${m}`];
  if (!scoreComplete(s)) return null;
  if (s.h > s.a) return home;
  if (s.a > s.h) return away;
  if (s.pen === "h") return home;
  if (s.pen === "a") return away;
  return null; // draw, shootout winner not picked yet
}

// Global match numbering for "Winner of M#" placeholders
function koMatchNumber(r, m) {
  let n = 0;
  for (let i = 0; i < r; i++) n += KO_ROUNDS[i].size;
  return n + m + 1;
}

// Invalidate every match downstream of (r, m) — its teams just changed
function clearDownstream(r, m) {
  if (r >= FINAL_ROUND) return;
  const nr = r + 1, nm = m >> 1;
  delete state.koScores[`${nr}-${nm}`];
  clearDownstream(nr, nm);
}

function champion() {
  return state.bracketTeams ? koWinner(FINAL_ROUND, 0) : null;
}

/* =========================================================
   DOM HELPERS
   ========================================================= */
const $ = sel => document.querySelector(sel);

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showScreen(name) {
  state.screen = name;
  saveState();
  for (const s of ["welcome", "groups", "knockout", "celebration"]) {
    $(`#screen-${s}`).classList.toggle("hidden", s !== name);
  }
  if (name === "celebration") startConfetti(); else stopConfetti();
  window.scrollTo({ top: 0 });
}

/* =========================================================
   RENDER — GROUP STAGE
   ========================================================= */
function renderGroups() {
  $("#groups-greeting").innerHTML =
    `Alright <strong>${esc(state.name)}</strong> — call every score. Top 2 advance, best 8 third-placed teams sneak through.`;

  const grid = $("#groups-grid");
  grid.innerHTML = GROUP_KEYS.map(gKey => {
    const fixturesHtml = groupFixtures(gKey).map(fx => {
      const s = state.groupScores[fx.id] || {};
      return `
        <div class="fixture">
          <span class="team home">${fx.home.flag} ${esc(fx.home.name)}</span>
          <span class="scorebox">
            <input class="score-input ${Number.isInteger(s.h) ? "filled" : ""}" type="number" min="0" max="20"
                   inputmode="numeric" value="${Number.isInteger(s.h) ? s.h : ""}"
                   data-match="${fx.id}" data-side="h" aria-label="${esc(fx.home.name)} goals">
            <span class="score-dash">–</span>
            <input class="score-input ${Number.isInteger(s.a) ? "filled" : ""}" type="number" min="0" max="20"
                   inputmode="numeric" value="${Number.isInteger(s.a) ? s.a : ""}"
                   data-match="${fx.id}" data-side="a" aria-label="${esc(fx.away.name)} goals">
          </span>
          <span class="team away">${esc(fx.away.name)} ${fx.away.flag}</span>
        </div>`;
    }).join("");

    return `
      <article class="group-card ${groupComplete(gKey) ? "complete" : ""}" id="group-card-${gKey}">
        <h3 class="group-name"><span>GROUP ${gKey}</span><span class="badge-done">${groupComplete(gKey) ? "✓ COMPLETE" : ""}</span></h3>
        ${fixturesHtml}
        <table class="standings">
          <thead>
            <tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>
          </thead>
          <tbody id="tbody-${gKey}">${standingsRowsHtml(gKey)}</tbody>
        </table>
      </article>`;
  }).join("");

  updateGroupProgress();
}

function standingsRowsHtml(gKey) {
  return computeStandings(gKey).map((row, i) => `
    <tr class="${i < 2 ? "q-direct" : i === 2 ? "q-third" : ""}">
      <td class="t-name">${row.team.flag} ${esc(row.team.name)}</td>
      <td>${row.p}</td><td>${row.w}</td><td>${row.d}</td><td>${row.l}</td>
      <td>${row.gf}</td><td>${row.ga}</td><td>${row.gd}</td><td class="pts">${row.pts}</td>
    </tr>`).join("");
}

function refreshGroup(gKey) {
  $(`#tbody-${gKey}`).innerHTML = standingsRowsHtml(gKey);
  const done = groupComplete(gKey);
  const card = $(`#group-card-${gKey}`);
  card.classList.toggle("complete", done);
  card.querySelector(".badge-done").textContent = done ? "✓ COMPLETE" : "";
}

function updateGroupProgress() {
  const n = predictedCount();
  $("#progress-count").textContent = n;
  $("#progress-fill").style.width = `${(n / TOTAL_GROUP_MATCHES) * 100}%`;
  const ready = n === TOTAL_GROUP_MATCHES;
  $("#btn-generate").disabled = !ready;
  const hint = $("#sticky-hint");
  hint.textContent = ready
    ? "All 72 matches predicted — let's see who survives!"
    : `Predict every match to unlock the knockouts (${TOTAL_GROUP_MATCHES - n} to go)`;
  hint.classList.toggle("ready", ready);
}

/* =========================================================
   RENDER — KNOCKOUT
   ========================================================= */
function renderKnockout() {
  const bracket = $("#bracket");
  bracket.innerHTML = KO_ROUNDS.map((round, r) => `
    <div class="round-col">
      <div class="round-title">${round.name}</div>
      <div class="round-matches">
        ${Array.from({ length: round.size }, (_, m) => koCardHtml(r, m)).join("")}
      </div>
    </div>`).join("");
  updateChampionBanner();
}

function koCardHtml(r, m) {
  const [home, away] = koTeams(r, m);
  const key = `${r}-${m}`;
  const s = state.koScores[key] || {};
  const winner = koWinner(r, m);
  const isFinal = r === FINAL_ROUND;
  const isDraw = scoreComplete(s) && s.h === s.a;

  const rowHtml = (team, side, feederMatch) => {
    const val = Number.isInteger(s[side]) ? s[side] : "";
    if (!team) {
      return `
        <div class="ko-row">
          <span class="team tbd">Winner M${feederMatch}</span>
          <input class="score-input" type="number" disabled>
        </div>`;
    }
    const isWin = winner && winner.name === team.name;
    return `
      <div class="ko-row ${isWin ? "winner" : ""}">
        <span class="team">${team.flag} ${esc(team.name)}</span>
        <input class="score-input ${val !== "" ? "filled" : ""}" type="number" min="0" max="20" inputmode="numeric"
               id="koin-${key}-${side}" value="${val}"
               data-ko="${key}" data-side="${side}" aria-label="${esc(team.name)} goals">
      </div>`;
  };

  let penHtml = "";
  if (isDraw && home && away) {
    penHtml = `
      <div class="pen-area">
        <div class="pen-title">⚽ PENALTY SHOOTOUT — pick the winner</div>
        <label><input type="radio" name="pen-${key}" value="h" data-ko="${key}" ${s.pen === "h" ? "checked" : ""}> ${home.flag} ${esc(home.name)}</label>
        <label><input type="radio" name="pen-${key}" value="a" data-ko="${key}" ${s.pen === "a" ? "checked" : ""}> ${away.flag} ${esc(away.name)}</label>
      </div>`;
  }

  return `
    <div class="ko-card ${winner ? "decided" : ""} ${isFinal ? "final-card" : ""}">
      <div class="ko-num">${isFinal ? "🏆 THE FINAL" : `Match ${koMatchNumber(r, m)}`}${isDraw && winner ? " · pens" : ""}</div>
      ${rowHtml(home, "h", r > 0 ? koMatchNumber(r - 1, m * 2) : "")}
      ${rowHtml(away, "a", r > 0 ? koMatchNumber(r - 1, m * 2 + 1) : "")}
      ${penHtml}
    </div>`;
}

function updateChampionBanner() {
  const champ = champion();
  const banner = $("#champion-banner");
  if (champ) {
    banner.innerHTML = `
      <span class="cb-text">${champ.flag} ${esc(champ.name)} lift the trophy!</span>
      <button class="btn btn-primary" id="btn-celebrate">Crown Your Champion 🏆</button>`;
    banner.classList.remove("hidden");
    $("#btn-celebrate").addEventListener("click", () => {
      renderCelebration();
      showScreen("celebration");
    });
  } else {
    banner.classList.add("hidden");
    banner.innerHTML = "";
  }
}

/* =========================================================
   RENDER — CELEBRATION
   ========================================================= */
function renderCelebration() {
  const champ = champion();
  if (!champ) return;
  const finalTeams = koTeams(FINAL_ROUND, 0);
  const runnerUp = finalTeams.find(team => team && team.name !== champ.name);
  const semiLosers = [0, 1]
    .map(m => {
      const teams = koTeams(FINAL_ROUND - 1, m);
      const w = koWinner(FINAL_ROUND - 1, m);
      return teams.find(team => team && w && team.name !== w.name);
    })
    .filter(Boolean);

  $("#celebrate-msg").innerHTML =
    `Congratulations <strong>${esc(state.name)}</strong>! Your predicted 2026 World Cup Champion is ` +
    `<span class="champ-name">${champ.flag} ${esc(champ.name)}</span>!`;

  $("#podium").innerHTML = `
    <div class="podium-card gold">
      <div class="p-label">🥇 Champion</div>
      <div class="p-team">${champ.flag} ${esc(champ.name)}</div>
    </div>
    ${runnerUp ? `
    <div class="podium-card">
      <div class="p-label">🥈 Runner-up</div>
      <div class="p-team">${runnerUp.flag} ${esc(runnerUp.name)}</div>
    </div>` : ""}
    ${semiLosers.map(team => `
    <div class="podium-card">
      <div class="p-label">Semi-finalist</div>
      <div class="p-team">${team.flag} ${esc(team.name)}</div>
    </div>`).join("")}`;
}

/* =========================================================
   EVENTS
   ========================================================= */
function parseScore(input) {
  if (input.value === "") return null;
  let v = parseInt(input.value, 10);
  if (Number.isNaN(v)) return null;
  v = Math.max(0, Math.min(20, v));
  if (String(v) !== input.value) input.value = v; // clamp visibly
  return v;
}

// --- Welcome ---
$("#welcome-form").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("#name-input").value.trim();
  if (!name) return;
  state.name = name;
  renderGroups();
  showScreen("groups");
});

// --- Group score inputs: live standings update, no re-render of inputs ---
$("#groups-grid").addEventListener("input", e => {
  const input = e.target;
  if (!input.matches(".score-input")) return;
  const matchId = input.dataset.match;
  const side = input.dataset.side;
  const v = parseScore(input);
  const s = state.groupScores[matchId] || { h: null, a: null };
  s[side] = v;
  state.groupScores[matchId] = s;
  input.classList.toggle("filled", v !== null);
  saveState();
  refreshGroup(matchId.split("-")[0]);
  updateGroupProgress();
});

// --- Generate knockouts ---
$("#btn-generate").addEventListener("click", () => {
  if (predictedCount() !== TOTAL_GROUP_MATCHES) return;
  const hadBracket = !!state.bracketTeams;
  if (hadBracket && Object.keys(state.koScores).length > 0) {
    const ok = confirm("Regenerating the bracket from your group results will clear your knockout predictions. Continue?");
    if (!ok) return;
  }
  state.bracketTeams = buildBracketTeams();
  state.koScores = {};
  saveState();
  renderKnockout();
  showScreen("knockout");
});

// --- Back to groups ---
$("#btn-back-groups").addEventListener("click", () => {
  renderGroups();
  showScreen("groups");
  $("#btn-generate").textContent = "Regenerate Knockouts ⚡";
});

// --- Knockout inputs (scores + penalty radios) ---
$("#bracket").addEventListener("input", e => {
  const el = e.target;
  const key = el.dataset.ko;
  if (!key) return;
  const [r, m] = key.split("-").map(Number);
  const prevWinner = koWinner(r, m);
  const s = state.koScores[key] || { h: null, a: null };

  if (el.type === "radio") {
    s.pen = el.value;
  } else {
    s[el.dataset.side] = parseScore(el);
    // A decisive score (or incomplete one) invalidates any stored shootout pick
    if (!(scoreComplete(s) && s.h === s.a)) delete s.pen;
  }
  state.koScores[key] = s;

  const newWinner = koWinner(r, m);
  if ((prevWinner && prevWinner.name) !== (newWinner && newWinner.name)) {
    clearDownstream(r, m);
  }
  saveState();

  // Full re-render, then restore focus so typing isn't interrupted
  const activeId = document.activeElement && document.activeElement.id;
  renderKnockout();
  if (activeId) {
    const el2 = document.getElementById(activeId);
    if (el2) el2.focus();
  }
});

// --- Celebration ---
$("#btn-view-bracket").addEventListener("click", () => showScreen("knockout"));
$("#btn-download").addEventListener("click", downloadTieSheet);
$("#btn-start-over").addEventListener("click", () => {
  if (!confirm("This wipes all your predictions. Start over?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  location.reload();
});

/* =========================================================
   TIE SHEET DOWNLOAD (canvas -> PNG)
   ========================================================= */
function buildTieSheetCanvas() {
  const SCALE = 2, PAD = 44, TITLE = 150, COLW = 330, GAP = 48, MATCH = 58, SLOT = 80;
  const W = PAD * 2 + COLW * 5 + GAP * 4;
  const H = TITLE + SLOT * 16 + PAD;
  const cv = document.createElement("canvas");
  cv.width = W * SCALE;
  cv.height = H * SCALE;
  const c = cv.getContext("2d");
  c.scale(SCALE, SCALE);

  const colX = r => PAD + r * (COLW + GAP);
  const matchY = (r, m) => {
    const slot = SLOT * Math.pow(2, r);
    return TITLE + m * slot + slot / 2 - MATCH / 2;
  };
  const box = (x, y, w, h, rad) => {
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  };
  const truncate = (text, maxW) => {
    if (c.measureText(text).width <= maxW) return text;
    while (text.length > 1 && c.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  };

  // Background + title
  c.fillStyle = "#070b14";
  c.fillRect(0, 0, W, H);
  const champ = champion();
  c.textBaseline = "alphabetic";
  c.fillStyle = "#00ff88";
  c.font = "900 30px Orbitron, sans-serif";
  c.fillText("2026 WORLD CUP — TIE SHEET", PAD, PAD + 8);
  c.fillStyle = "#8595b5";
  c.font = "500 15px Inter, sans-serif";
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  c.fillText(`Predicted by ${state.name} · ${today}`, PAD, PAD + 34);
  c.fillStyle = "#ffd60a";
  c.font = "700 17px Inter, sans-serif";
  c.fillText(`🏆 Champion: ${champ.flag} ${champ.name}`, PAD, PAD + 60);

  // Connectors
  c.strokeStyle = "rgba(0, 212, 255, 0.3)";
  c.lineWidth = 1.5;
  for (let r = 1; r < KO_ROUNDS.length; r++) {
    for (let m = 0; m < KO_ROUNDS[r].size; m++) {
      const xe = colX(r), midX = xe - GAP / 2, yT = matchY(r, m) + MATCH / 2;
      for (const feeder of [m * 2, m * 2 + 1]) {
        const yF = matchY(r - 1, feeder) + MATCH / 2;
        c.beginPath();
        c.moveTo(colX(r - 1) + COLW, yF);
        c.lineTo(midX, yF);
        c.lineTo(midX, yT);
        c.lineTo(xe, yT);
        c.stroke();
      }
    }
  }

  // Matches
  for (let r = 0; r < KO_ROUNDS.length; r++) {
    // Column header
    c.fillStyle = "#00d4ff";
    c.font = "700 13px Orbitron, sans-serif";
    const label = KO_ROUNDS[r].name.toUpperCase();
    c.fillText(label, colX(r) + (COLW - c.measureText(label).width) / 2, TITLE - 14);

    for (let m = 0; m < KO_ROUNDS[r].size; m++) {
      const x = colX(r), y = matchY(r, m);
      const [home, away] = koTeams(r, m);
      const s = state.koScores[`${r}-${m}`] || {};
      const winner = koWinner(r, m);
      const isPens = scoreComplete(s) && s.h === s.a;
      const isFinal = r === FINAL_ROUND;

      box(x, y, COLW, MATCH, 9);
      c.fillStyle = "#111a2e";
      c.fill();
      c.strokeStyle = isFinal ? "rgba(255, 214, 10, 0.7)" : "#233354";
      c.lineWidth = isFinal ? 2 : 1;
      c.stroke();

      [[home, s.h, "h"], [away, s.a, "a"]].forEach(([team, goals, side], row) => {
        const ty = y + 23 + row * 24;
        const isWin = team && winner && winner.name === team.name;
        c.fillStyle = isWin ? "#00ff88" : "#e8eefb";
        c.font = `${isWin ? 700 : 500} 14px Inter, sans-serif`;
        c.fillText(truncate(team ? `${team.flag} ${team.name}` : "—", COLW - 70), x + 12, ty);
        const scoreText = Number.isInteger(goals)
          ? String(goals) + (isPens && s.pen === side ? " (p)" : "")
          : "";
        c.fillText(scoreText, x + COLW - 14 - c.measureText(scoreText).width, ty);
      });
    }
  }
  return cv;
}

function downloadTieSheet() {
  if (!state.bracketTeams || !champion()) return;
  const cv = buildTieSheetCanvas();
  cv.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wc2026-tie-sheet-${state.name.replace(/[^\w-]+/g, "_") || "prediction"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
}

/* =========================================================
   CONFETTI (vanilla canvas)
   ========================================================= */
const confettiCanvas = $("#confetti-canvas");
const ctx = confettiCanvas.getContext("2d");
const CONFETTI_COLORS = ["#00ff88", "#00d4ff", "#ff3d8b", "#ffd60a", "#9b5cff", "#ffffff"];
let confettiPieces = [];
let confettiRAF = null;

function startConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  confettiPieces = Array.from({ length: 180 }, () => ({
    x: Math.random() * confettiCanvas.width,
    y: -20 - Math.random() * confettiCanvas.height,
    w: 6 + Math.random() * 8,
    h: 8 + Math.random() * 10,
    vy: 1.5 + Math.random() * 3,
    vx: -1 + Math.random() * 2,
    rot: Math.random() * Math.PI * 2,
    vr: -0.1 + Math.random() * 0.2,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  }));
  cancelAnimationFrame(confettiRAF);
  confettiLoop();
}

function confettiLoop() {
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  for (const p of confettiPieces) {
    p.x += p.vx + Math.sin(p.y * 0.01);
    p.y += p.vy;
    p.rot += p.vr;
    if (p.y > confettiCanvas.height + 20) {
      p.y = -20;
      p.x = Math.random() * confettiCanvas.width;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  confettiRAF = requestAnimationFrame(confettiLoop);
}

function stopConfetti() {
  cancelAnimationFrame(confettiRAF);
  confettiRAF = null;
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

window.addEventListener("resize", () => {
  if (confettiRAF) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
});

/* =========================================================
   INIT — restore saved session
   ========================================================= */
(function init() {
  let screen = state.screen;
  if (screen !== "welcome" && !state.name) screen = "welcome";
  if ((screen === "knockout" || screen === "celebration") && !state.bracketTeams) screen = "groups";
  if (screen === "celebration" && !champion()) screen = "knockout";

  if (screen === "groups" || screen === "knockout" || screen === "celebration") renderGroups();
  if (screen === "knockout" || screen === "celebration") renderKnockout();
  if (screen === "celebration") renderCelebration();
  if (state.bracketTeams) $("#btn-generate").textContent = "Regenerate Knockouts ⚡";
  showScreen(screen);
})();
