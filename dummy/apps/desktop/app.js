const state = { token: null, user: null, assessment: null, attempt: null };
const root = document.querySelector("#app");

function shell(content) {
  root.innerHTML = `<div class="shell"><div class="top"><div class="brand">Assess<span>X</span> <small>mini</small></div>${state.user ? `<button class="secondary" onclick="logout()">Sign out</button>` : ""}</div>${content}</div>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function login() {
  shell(`<div class="panel narrow"><p class="muted">DESKTOP EXAM CLIENT</p><h1>Sign in</h1><p class="muted">Use candidate@example.com / candidate123</p><form onsubmit="submitLogin(event)"><label class="label">Email</label><input id="email" type="email" value="candidate@example.com" required><label class="label">Password</label><input id="password" type="password" value="candidate123" required><div id="error"></div><button>Continue</button></form></div>`);
}

async function submitLogin(event) {
  event.preventDefault();
  try { const data = await api("/api/login", { method: "POST", body: JSON.stringify({ email: email.value, password: password.value }) }); state.token = data.token; state.user = data.user; dashboard(); }
  catch (error) { document.querySelector("#error").innerHTML = `<p class="error">${error.message}</p>`; }
}

async function dashboard() {
  const data = await api("/api/assessments");
  const adminNote = state.user.role === "admin" ? `<p class="muted">Admin preview: this compact replica includes the same role boundary, but authoring and monitoring are intentionally omitted.</p>` : "";
  shell(`<div class="panel"><p class="muted">${state.user.role.toUpperCase()} WORKSPACE</p><h1>Welcome, ${state.user.name}</h1>${adminNote}<h2>Available assessments</h2><div>${data.assessments.map(item => `<div class="assessment"><div><strong>${item.title}</strong><p class="muted">${item.questions.length} questions · ${item.duration_minutes} minutes · ${item.status}</p></div>${state.user.role === "candidate" ? `<button onclick="start('${item.id}')">Start</button>` : ""}</div>`).join("")}</div></div>`);
}

async function start(id) {
  try { const data = await api("/api/attempts", { method: "POST", body: JSON.stringify({ assessment_id: id }) }); state.attempt = data.attempt; state.assessment = data.assessment; exam(); }
  catch (error) { alert(error.message); }
}

function exam() {
  shell(`<div class="panel"><p class="muted">IN PROGRESS · ${state.assessment.duration_minutes} MINUTES</p><h1>${state.assessment.title}</h1><form onsubmit="submitExam(event)">${state.assessment.questions.map((question, index) => `<div class="question"><strong>${index + 1}. ${question.text}</strong>${question.options.map(option => `<label class="option"><input required type="radio" name="${question.id}" value="${option}"> ${option}</label>`).join("")}</div>`).join("")}<button>Submit assessment</button></form></div>`);
}

async function submitExam(event) {
  event.preventDefault();
  const answers = Object.fromEntries(new FormData(event.target).entries());
  try { const data = await api(`/api/attempts/${state.attempt.id}/submit`, { method: "POST", body: JSON.stringify({ answers }) }); const result = data.attempt; shell(`<div class="panel"><p class="muted">ASSESSMENT COMPLETE</p><h1>${result.candidate}</h1><p class="score">${result.score}/${result.total}</p><p>Your objective result is recorded. No single signal or score is a hiring decision.</p><button onclick="dashboard()">Back to dashboard</button></div>`); }
  catch (error) { alert(error.message); }
}

function logout() { state.token = null; state.user = null; login(); }
login();
