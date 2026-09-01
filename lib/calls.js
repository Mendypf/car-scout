// Bulk-call engine, running on Vapi.
// Each dealership gets one call that asks a single question: do you have this
// car? The verdict and the exact charge for that call are stored per row.

import { createCall, getCall, buildCallBody, toE164 } from "./vapi.js";
import { config, VOICE } from "./config.js";

// Run up to `limit` calls at a time.
async function pooled(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

const POLL_MS = 6000;
const MAX_CALL_MS = 5 * 60 * 1000;
const CONCURRENT_CALLS = 3;

const LIVE = new Set(["queued", "ringing", "in-progress", "forwarding"]);

function classify(text, endedReason) {
  const reason = String(endedReason || "").toLowerCase();
  if (/voicemail/.test(reason)) return "voicemail";
  if (/no-answer|did-not-answer|customer-busy|failed|error|twilio/.test(reason)) return "no_answer";
  const t = (text || "").toLowerCase();
  if (!t.trim()) return "no_answer";
  if (/(we (do )?have|in stock|on the lot|it'?s here|available|just came in|got one|yes,? we)/.test(t))
    return "has_it";
  if (/(don'?t have|do not have|sold( it)?( already)?|no longer|not in stock|nothing like|can'?t get|we don'?t)/.test(t))
    return "no";
  return "unclear";
}

function transcriptOf(call) {
  if (typeof call?.transcript === "string" && call.transcript.trim()) return call.transcript;
  const t = call?.artifact?.transcript;
  if (typeof t === "string" && t.trim()) return t;
  const msgs = call?.artifact?.messages || call?.messages;
  if (Array.isArray(msgs)) {
    return msgs
      .filter((m) => m.role !== "system" && (m.message || m.content))
      .map((m) => `${m.role === "bot" || m.role === "assistant" ? "AI" : "Dealer"}: ${m.message || m.content}`)
      .join("\n");
  }
  return "";
}

async function runOneCall(campaign, call, save) {
  const to = toE164(call.dealer.phone);
  if (!to) {
    call.status = "bad_number";
    call.done = true;
    return save();
  }
  try {
    call.status = "dialing";
    save();

    const created = await createCall(
      config.vapiKey,
      buildCallBody({
        phoneNumberId: campaign.phoneNumberId,
        to,
        carDescription: campaign.carDescription,
        dealerName: call.dealer.name,
        voice: VOICE,
        opening: campaign.opening,
        rules: campaign.rules,
      })
    );
    call.callId = created?.id || null;
    call.status = "calling";
    save();

    const started = Date.now();
    let latest = created;
    while (Date.now() - started < MAX_CALL_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      latest = await getCall(config.vapiKey, call.callId);
      if (!LIVE.has(latest?.status)) break;
    }

    call.cost = Number(latest?.cost || 0);
    call.seconds =
      latest?.startedAt && latest?.endedAt
        ? Math.round((new Date(latest.endedAt) - new Date(latest.startedAt)) / 1000)
        : null;
    call.endedReason = latest?.endedReason || null;
    call.transcript = transcriptOf(latest);
    call.summary = latest?.analysis?.summary || latest?.summary || null;
    call.recordingUrl = latest?.recordingUrl || latest?.artifact?.recordingUrl || null;
    call.status = classify(call.transcript, call.endedReason);
    call.done = true;
  } catch (e) {
    call.status = "failed";
    call.error = String(e?.message || e).slice(0, 300);
    call.done = true;
  }
  campaign.totalCost =
    Math.round(campaign.calls.reduce((s, c) => s + (c.cost || 0), 0) * 10000) / 10000;
  save();
}

export function startCampaign(store, { carDescription, dealers, phoneNumberId, opening, rules }) {
  const campaign = {
    id: `cmp_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    carDescription,
    opening,
    rules,
    phoneNumberId,
    totalCost: 0,
    calls: dealers.map((d) => ({
      dealer: { name: d.name, phone: d.phone, address: d.address || null },
      status: "queued",
      done: false,
      cost: 0,
    })),
  };
  store.data.campaigns.unshift(campaign);
  store.save();

  const save = () => store.save();
  pooled(campaign.calls, CONCURRENT_CALLS, (call) => runOneCall(campaign, call, save))
    .then(() => {
      campaign.finishedAt = new Date().toISOString();
      store.save();
    })
    .catch(() => store.save());

  return campaign;
}
