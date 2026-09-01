const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (x) => "$" + (Math.round((x || 0) * 100) / 100).toFixed(2);
const money4 = (x) => (!x ? "no charge" : x >= 0.01 ? money(x) : "$" + x.toFixed(4));

async function api(url, body) {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

let health = { vapi: { numbers: [] }, prices: null };
let dealers = [];
let lastQuery = null;
let pollTimer = null;

const formQuery = () => ({
  make: $("make").value.trim(),
  model: $("model").value.trim(),
  zip: $("zip").value.trim(),
  radius: Number($("radius").value),
  stockType: $("stockType").value,
  yearMin: $("yearMin").value,
  yearMax: $("yearMax").value,
  priceMax: $("priceMax").value,
  mileageMax: $("mileageMax").value,
});

const showError = (el, msg) => {
  el.textContent = msg;
  el.hidden = !msg;
};

// ---------- keys ----------

$("keys-btn").addEventListener("click", () => {
  $("keys-dialog").showModal();
  $("keys-dialog").querySelector("h2").focus();
});

async function loadHealth() {
  health = await api("/api/health");
  const v = health.vapi;

  const vapiState = $("vapi-state");
  vapiState.textContent = v.ok ? "connected" : v.error ? "key rejected" : "not set";
  vapiState.className = "state " + (v.ok ? "on" : "off");

  const pubState = $("vapipub-state");
  pubState.textContent = health.vapiPublicKey ? "saved" : "not set";
  pubState.className = "state " + (health.vapiPublicKey ? "on" : "off");

  const scState = $("sc-state");
  scState.textContent = health.marketplace ? "saved" : "not set";
  scState.className = "state " + (health.marketplace ? "on" : "off");

  const sel = $("vapiPhoneNumberId");
  sel.innerHTML = v.numbers.length
    ? v.numbers.map((n) => `<option value="${esc(n.id)}">${esc(n.number || n.name || n.id)}</option>`).join("")
    : `<option value="">no numbers on this account</option>`;
  if (health.selectedPhoneNumberId) sel.value = health.selectedPhoneNumberId;

  $("keys-btn").classList.toggle("needed", !v.ok);
}

$("save-settings").addEventListener("click", async () => {
  $("settings-msg").textContent = "saving…";
  try {
    await api("/api/settings", {
      vapiKey: $("vapiKey").value,
      vapiPhoneNumberId: $("vapiPhoneNumberId").value,
      vapiPublicKey: $("vapiPublicKey").value,
      scrapeCreatorsKey: $("scrapeCreatorsKey").value,
    });
    $("vapiKey").value = "";
    $("vapiPublicKey").value = "";
    $("scrapeCreatorsKey").value = "";
    await loadHealth();
    $("settings-msg").textContent = "saved";
  } catch (e) {
    $("settings-msg").textContent = e.message;
  }
});

const line = (what, amt, note = "", cls = "") =>
  `<div class="price-line ${cls}"><span class="what">${what}${note ? `<span class="note">${note}</span>` : ""}</span><span class="amt">${amt}</span></div>`;

$("pricing-btn").addEventListener("click", () => {
  const p = health.prices;
  const s = p.search;
  $("pricing-body").innerHTML = `
    <div class="price-group">
      <h3>Free</h3>
      ${line("Searching listings", "free", "Dealer inventory and private sellers, plus whatever your own agent digs up")}
      ${line("Finding who to call", "free", "Dealer phone numbers come with the listings")}
      ${line("Reading the call script", "free", "Word for word, before anything dials")}
    </div>
    <div class="price-group">
      <h3>You pay for</h3>
      ${line("Each phone call", `~${money(p.callPerMinuteEstimate)} a min`, "Most run 1 to 2 minutes. No answer costs nothing.")}
      ${line(
        "Facebook Marketplace",
        health.marketplace ? money4(s.facebook) : "off",
        health.marketplace ? "Per search, adds private sellers" : "Optional — add a ScrapeCreators key to turn it on"
      )}
    </div>`;
  $("pricing-dialog").showModal();
  $("pricing-dialog").querySelector("h2").focus();
});

// ---------- search ----------

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError($("form-error"), "");
  const btn = $("search-btn");
  btn.disabled = true;
  btn.textContent = "Searching…";
  try {
    lastQuery = formQuery();
    const r = await api("/api/search", lastQuery);
    renderListings(r);
    dealers = (r.dealers || []).map((d) => ({ ...d, checked: true }));
  } catch (err) {
    showError($("form-error"), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Search listings";
  }
});

function renderListings(r) {
  $("results-panel").hidden = false;
  $("results-title").textContent = `${r.listings.length} listing${r.listings.length === 1 ? "" : "s"}`;
  $("results-cost").textContent =
    Object.entries(r.sourceStatus)
      .map(([n, s]) => (s.ok ? `${n} ${s.count}` : `${n} failed`))
      .join(" · ") + ` — ${money4(r.cost)}`;

  const isNew = lastQuery?.stockType === "new";
  $("callbar-title").textContent = isNew
    ? "Want the real price on one of these?"
    : "Sure these are still on the lot?";
  $("callbar-sub").textContent = isNew
    ? "Have the dealerships near you called and asked what they have in stock and what they're actually asking for it."
    : "Listings stay up after a car sells, and fresh trade-ins never make it online. A call gets you what's really there, the asking price and the mileage.";

  $("results").innerHTML =
    r.listings
      .map(
        (l) => `<article class="card">
      ${l.photo ? `<img src="${esc(l.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="noimg">no photo</div>`}
      <div class="body">
        <div class="price">${l.price ? "$" + l.price.toLocaleString() : "ask"}</div>
        <div class="title">${esc(l.title)}</div>
        <div class="sub">${l.mileage ? l.mileage.toLocaleString() + " miles" : "mileage not listed"}${
          l.dealer?.name ? " · " + esc(l.dealer.name) : ""
        }</div>
        <div class="sub tag">${esc(l.source)}${l.sourceSite ? " · " + esc(l.sourceSite) : ""}${l.privateSeller ? " · private seller" : ""}${
          l.daysListed != null ? ` · listed ${l.daysListed}d ago` : ""
        }</div>
        ${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">Open listing</a>` : ""}
      </div>
    </article>`
      )
      .join("") || `<p class="muted">Nothing matched. Widen the radius or drop a filter.</p>`;
}

// ---------- find dealerships ----------

$("call-btn").addEventListener("click", async () => {
  showError($("form-error"), "");
  const q = lastQuery || formQuery();
  try {
    // Free: these dealerships already came back with the search results.
    const r = await api("/api/dealers");
    const known = new Set(dealers.map((d) => normPhone(d.phone)));
    for (const d of r.dealers) if (!known.has(normPhone(d.phone))) dealers.push({ ...d, checked: true });
    if (!dealers.length) {
      showError($("form-error"), "No dealer phone numbers in these results. Search a wider radius, or have your agent import dealerships.");
      return;
    }
    $("dealers-panel").hidden = false;
    $("dealers-title").textContent = `${dealers.length} dealerships that have one listed near ${q.zip}`;
    renderDealers();
    loadScript();
    $("dealers-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showError($("form-error"), err.message);
  }
});

const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10);

function describeCar(q) {
  const bits = [q.stockType === "used" ? "a used" : q.stockType === "new" ? "a new" : "a"];
  if (q.yearMin && q.yearMax) bits.push(`${q.yearMin} to ${q.yearMax}`);
  else if (q.yearMin) bits.push(`${q.yearMin} or newer`);
  else if (q.yearMax) bits.push(`${q.yearMax} or older`);
  bits.push(q.make, q.model);
  if (q.priceMax) bits.push(`under $${Number(q.priceMax).toLocaleString()}`);
  if (q.mileageMax) bits.push(`with under ${Number(q.mileageMax).toLocaleString()} miles`);
  return bits.join(" ");
}

function renderDealers() {
  $("dealer-list").innerHTML = dealers
    .map(
      (d, i) => `<label class="dealer${d.phone ? "" : " nonum"}">
      <input type="checkbox" data-i="${i}" ${d.checked ? "checked" : ""} ${d.phone ? "" : "disabled"}>
      <span>
        <span class="name">${esc(d.name)}</span>
        <span class="sub"> ${d.phone ? esc(d.phone) : "no number listed"}${
          d.address ? " · " + esc(d.address) : ""
        }${d.distance != null ? " · " + d.distance + " mi" : ""}</span>
        ${d.cars?.length ? `<span class="match">already lists ${esc(d.cars[0])}</span>` : ""}
      </span>
    </label>`
    )
    .join("");
  $("dealer-list").querySelectorAll("input").forEach((cb) =>
    cb.addEventListener("change", () => {
      dealers[Number(cb.dataset.i)].checked = cb.checked;
      renderCosts();
    })
  );
  renderCosts();
}

function renderCosts() {
  const p = health.prices;
  const n = dealers.filter((d) => d.checked).length;
  const low = n * p.callPerMinuteEstimate;
  const typ = n * p.callPerMinuteEstimate * p.callTypicalMinutes;
  const max = n * p.callPerMinuteEstimate * p.callMaxMinutes;

  $("cost-table").innerHTML = `
    <tr><th>What you're paying for</th><th>Rate</th><th>Cost</th></tr>
    <tr><td>Finding these dealerships</td><td>came with the search</td><td>free</td></tr>
    <tr><td>${n} call${n === 1 ? "" : "s"}</td><td>about ${money(p.callPerMinuteEstimate)} a minute</td><td>${money(typ)} typical</td></tr>
    <tr class="total"><td>Estimated total</td><td>1 to 3 min a call</td><td>${money(low)} – ${money(max)}</td></tr>`;

  $("start-calls").disabled = n === 0;
  $("call-note").textContent = n ? `${n} selected` : "Pick at least one dealership.";
}

// ---------- hear it before paying ----------

let script = null;
let scriptEdited = false;

// Fills the two boxes with the generated wording — unless the user has typed
// their own, which always wins until they hit reset.
async function loadScript({ force = false } = {}) {
  try {
    script = await api("/api/call-script", { carDescription: describeCar(lastQuery || formQuery()) });
    if (force || !scriptEdited) {
      $("opening").value = script.opening;
      $("script").value = script.rules;
      scriptEdited = false;
    }
  } catch {
    /* leave whatever is in the boxes */
  }
}

["opening", "script"].forEach((id) => $(id).addEventListener("input", () => (scriptEdited = true)));

$("reset-script").addEventListener("click", () => loadScript({ force: true }));

// Listen in the browser: the same assistant, over the Vapi web SDK.
let vapiClient = null;
let listening = false;

async function getVapi(publicKey) {
  if (!vapiClient) {
    const mod = await import("https://cdn.jsdelivr.net/npm/@vapi-ai/web@2.7.0/+esm");
    // jsDelivr wraps the CJS build twice: the constructor sits at default.default.
    const Vapi = typeof mod.default === "function" ? mod.default : mod.default?.default || mod.Vapi;
    vapiClient = new Vapi(publicKey);
  }
  return vapiClient;
}

$("listen-btn").addEventListener("click", async () => {
  const btn = $("listen-btn");
  if (listening) {
    vapiClient?.stop();
    return;
  }
  btn.disabled = true;
  btn.textContent = "Connecting…";
  try {
    const { publicKey, assistant } = await api("/api/preview-assistant", {
      carDescription: describeCar(lastQuery || formQuery()),
      opening: $("opening").value,
      rules: $("script").value,
    });
    if (!publicKey)
      throw new Error("Add your Vapi public key under Add keys — it's on the same page as the private one.");
    const vapi = await getVapi(publicKey);
    vapi.removeAllListeners?.();
    vapi.on("call-start", () => {
      listening = true;
      btn.disabled = false;
      btn.textContent = "■ Stop listening";
      btn.classList.add("speaking");
      $("listen-note").textContent = "Live. This is the voice and the words a dealership hears.";
    });
    vapi.on("call-end", () => {
      listening = false;
      btn.disabled = false;
      btn.textContent = "▶ Listen to it here";
      btn.classList.remove("speaking");
      $("listen-note").textContent = "Ended. Press again to hear it once more.";
    });
    vapi.on("error", (e) => {
      listening = false;
      btn.disabled = false;
      btn.textContent = "▶ Listen to it here";
      btn.classList.remove("speaking");
      $("listen-note").textContent = String(e?.errorMsg || e?.message || e).slice(0, 200);
    });
    await vapi.start(assistant);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "▶ Listen to it here";
    $("listen-note").textContent = err.message;
  }
});

$("nearby-btn").addEventListener("click", async () => {
  const btn = $("nearby-btn");
  const q = lastQuery || formQuery();
  btn.disabled = true;
  btn.textContent = "Checking the map…";
  try {
    const r = await api("/api/dealers/nearby", { zip: q.zip, radius: q.radius, make: q.make });
    const known = new Set(dealers.map((d) => normPhone(d.phone)).filter(Boolean));
    let added = 0;
    let phoneless = 0;
    for (const d of r.dealers) {
      if (d.phone && known.has(normPhone(d.phone))) continue;
      if (!d.phone) phoneless++;
      dealers.push({ ...d, checked: !!d.phone && d.matchesMake });
      if (d.phone) added++;
    }
    renderDealers();
    $("dealers-title").textContent = `${dealers.filter((d) => d.phone).length} dealerships near ${q.zip}`;
    $("nearby-note").textContent =
      `${added} more with numbers` +
      (phoneless ? ` · ${phoneless} found without a listed number — your agent can dig those up` : "");
  } catch (err) {
    $("nearby-note").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Find more dealerships nearby — free";
  }
});

$("script-toggle").addEventListener("click", () => {
  const s = $("script-wrap");
  s.hidden = !s.hidden;
  $("script-toggle").textContent = s.hidden ? "edit the rest of the script" : "hide the script";
});

// ---------- run the calls ----------

// Two-step arm instead of a popup: first press shows exactly what will
// happen, second press dials. Anything else backs out.
let armed = false;
let armTimer = null;

function disarm() {
  armed = false;
  clearTimeout(armTimer);
  $("start-calls").classList.remove("armed");
  $("cancel-arm").hidden = true;
  const n = dealers.filter((d) => d.checked).length;
  $("start-calls").textContent = "Call the selected dealerships";
  $("call-note").textContent = n ? `${n} selected` : "Pick at least one dealership.";
}
$("cancel-arm").addEventListener("click", disarm);

$("start-calls").addEventListener("click", async () => {
  showError($("call-error"), "");
  const picked = dealers.filter((d) => d.checked);
  if (!$("opening").value.trim()) {
    showError($("call-error"), "The opening line can't be empty.");
    return;
  }
  if (!armed) {
    armed = true;
    $("start-calls").classList.add("armed");
    $("start-calls").textContent = `Yes — dial ${picked.length} dealership${picked.length === 1 ? "" : "s"} now`;
    $("cancel-arm").hidden = false;
    $("call-note").textContent = "Press again to start, or cancel.";
    armTimer = setTimeout(disarm, 8000);
    return;
  }
  disarm();
  const btn = $("start-calls");
  btn.disabled = true;
  try {
    await api("/api/campaigns", {
      carDescription: describeCar(lastQuery || formQuery()),
      opening: $("opening").value,
      rules: $("script").value,
      dealers: picked.map((d) => ({ name: d.name, phone: d.phone, address: d.address })),
      phoneNumberId: $("vapiPhoneNumberId").value || health.selectedPhoneNumberId,
    });
    $("dealers-panel").hidden = true;
    pollBoard();
  } catch (err) {
    showError($("call-error"), err.message);
  } finally {
    btn.disabled = false;
  }
});

const LABEL = {
  queued: "queued",
  dialing: "dialing",
  calling: "on the call",
  has_it: "has it",
  no: "doesn't have it",
  unclear: "read the call",
  no_answer: "no answer",
  voicemail: "voicemail",
  failed: "call failed",
  bad_number: "bad number",
};

async function pollBoard() {
  try {
    const runs = await api("/api/campaigns");
    if (runs.length) {
      $("board-panel").hidden = false;
      $("board-spend").textContent = `${money(runs.reduce((s, c) => s + (c.totalCost || 0), 0))} charged so far`;
      $("board").innerHTML = runs.map(renderRun).join("");
    }
    const live = runs.some((c) => c.calls.some((x) => !x.done));
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollBoard, live ? 5000 : 30000);
  } catch {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollBoard, 15000);
  }
}

function renderRun(c) {
  const done = c.calls.filter((x) => x.done).length;
  return `<div class="run">
    <p class="muted" style="margin:0 0 8px">Asking about ${esc(c.carDescription)} — ${done} of ${c.calls.length} done</p>
    ${c.calls
      .map(
        (x) => `<div class="callrow">
        <span><span class="chip ${esc(x.status)}">${LABEL[x.status] || esc(x.status)}</span></span>
        <span class="who">
          <span class="name">${esc(x.dealer.name)}</span>
          <span class="sub">${esc(x.dealer.phone)}</span>
        </span>
        <span class="charge">${x.done ? money4(x.cost || 0) + (x.seconds ? ` · ${x.seconds}s` : "") : ""}</span>
        ${x.summary ? `<span class="said">${esc(x.summary)}</span>` : ""}
        ${x.transcript ? `<details><summary>full call</summary><pre>${esc(x.transcript)}</pre></details>` : ""}
        ${x.error ? `<span class="said" style="color:var(--bad)">${esc(x.error)}</span>` : ""}
      </div>`
      )
      .join("")}
  </div>`;
}

loadHealth();
pollBoard();
