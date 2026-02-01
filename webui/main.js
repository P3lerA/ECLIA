import "./style.css";

const modelSelect = document.getElementById("modelSelect");
const tempInput = document.getElementById("temp");
const maxTokensInput = document.getElementById("maxTokens");
const jsonModeInput = document.getElementById("jsonMode");
const clearBtn = document.getElementById("clearBtn");
const sendBtn = document.getElementById("sendBtn");
const debugBtn = document.getElementById("debugBtn");
const debugPre = document.getElementById("debug");
const input = document.getElementById("input");
const chat = document.getElementById("chat");

let messages = []; // OpenAI-style chat history
let lastDebug = null;

function addMsg(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = content;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function loadModels() {
  modelSelect.innerHTML = `<option>Loading...</option>`;
  const res = await fetch("/api/v1/models");
  if (!res.ok) throw new Error(`Failed to load models: ${res.status}`);
  const data = await res.json();

  const ids = (data?.data ?? []).map((m) => m.id).sort();
  modelSelect.innerHTML = "";
  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    modelSelect.appendChild(opt);
  }
  if (ids.length) modelSelect.value = ids[0];
}

function buildRequest(userText) {
  const model = modelSelect.value;
  const temperature = Number(tempInput.value);
  const max_tokens = Number(maxTokensInput.value);

  const reqMessages = [
    ...messages,
    { role: "user", content: userText },
  ];

  const body = {
    model,
    messages: reqMessages,
    temperature,
    max_tokens,
  };

  if (jsonModeInput.checked) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

async function sendOnce(userText) {
  const body = buildRequest(userText);

  lastDebug = { request: body, response: null, raw: null };

  const res = await fetch("/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  lastDebug.raw = raw;

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}\n${raw}`);
  }

  const data = JSON.parse(raw);
  lastDebug.response = data;

  const content = data?.choices?.[0]?.message?.content ?? "";
  return content;
}

function renderDebug() {
  if (!lastDebug) {
    debugPre.textContent = "No request yet.";
    return;
  }
  debugPre.textContent =
    "=== REQUEST ===\n" +
    JSON.stringify(lastDebug.request, null, 2) +
    "\n\n=== RESPONSE (parsed) ===\n" +
    JSON.stringify(lastDebug.response, null, 2) +
    "\n\n=== RESPONSE (raw) ===\n" +
    lastDebug.raw;
}

async function onSend() {
  const userText = input.value.trim();
  if (!userText) return;

  input.value = "";
  sendBtn.disabled = true;

  addMsg("user", userText);
  messages.push({ role: "user", content: userText });

  try {
    const reply = await sendOnce(userText);

    addMsg("assistant", reply);
    messages.push({ role: "assistant", content: reply });
  } catch (e) {
    addMsg("assistant", `❌ ${String(e?.message ?? e)}`);
  } finally {
    sendBtn.disabled = false;
  }
}

clearBtn.addEventListener("click", () => {
  messages = [];
  chat.innerHTML = "";
  lastDebug = null;
  debugPre.classList.add("hidden");
});

sendBtn.addEventListener("click", onSend);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    onSend();
  }
});

debugBtn.addEventListener("click", () => {
  debugPre.classList.toggle("hidden");
  renderDebug();
});

(async function bootstrap() {
  addMsg("assistant", "Booting...");
  try {
    await loadModels();
    chat.innerHTML = "";
    addMsg("assistant", "Ready. Ctrl+Enter to send message.");
  } catch (e) {
    chat.innerHTML = "";
    addMsg("assistant", `❌ Launch Failed：${String(e?.message ?? e)}`);
  }
})();
