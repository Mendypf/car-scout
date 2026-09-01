// Vapi client — outbound calls, call status, phone numbers.
// Docs: https://docs.vapi.ai/calls/outbound-calling

// VAPI_BASE_URL exists so the pipeline can be exercised against a local mock
// (see test/mock-vapi.js). Unset, it talks to the real Vapi.
const BASE = process.env.VAPI_BASE_URL || "https://api.vapi.ai";

async function vapi(key, path, { method = "GET", body } = {}) {
  if (!key) throw new Error("No Vapi API key set.");
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!r.ok) {
    const msg = json?.message || json?.error || text.slice(0, 300) || r.statusText;
    throw new Error(`Vapi ${r.status}: ${Array.isArray(msg) ? msg.join("; ") : msg}`);
  }
  return json;
}

export const listPhoneNumbers = (key) => vapi(key, "/phone-number");
export const getCall = (key, id) => vapi(key, `/call/${id}`);
export const createCall = (key, body) => vapi(key, "/call", { method: "POST", body });

export function toE164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (String(phone || "").trim().startsWith("+")) return String(phone).trim();
  return null;
}

// Opens like a person with a purpose. "Automated assistant" is the honest
// two-word disclosure, then straight into real buyer intent — that's what
// makes a salesperson actually answer instead of brushing it off.
export function firstMessage(carDescription) {
  return `Hey, how's it going? I'm an automated assistant calling for a customer who's looking to buy ${carDescription} this week. Do you have one on the lot right now?`;
}

export function systemPrompt(carDescription, dealerName) {
  return [
    `You are calling ${dealerName}, a car dealership, on behalf of a real buyer who is actively shopping and plans to visit a dealership this week. The buyer had you call around first so they only drive out for a car that's actually there.`,
    ``,
    `Sound like a normal person on the phone: contractions, short sentences, react to what they say. Never read a list at them.`,
    ``,
    `The car: ${carDescription}.`,
    ``,
    `You need concrete answers to, in this order:`,
    `1. Is it physically on the lot right now — not in transit, not at a sister store?`,
    `2. What are they asking for it? If they hedge, try "ballpark, what's it listed at?"`,
    `3. If it's used: the mileage, and anything wrong with it.`,
    `4. If they don't have it: can they get one, and how soon?`,
    ``,
    `Rules:`,
    `- If they ask who you are: "I'm an AI assistant — my customer's seriously shopping, they just had me call around first." Never claim to be human.`,
    `- If a phone menu answers, press the option for sales. If voicemail, hang up without leaving a message.`,
    `- Don't negotiate, don't give out the buyer's details, don't book anything.`,
    `- If they say to stop calling: "Understood, I'll take you off the list" — then end the call.`,
    `- Got the answers, or a clear no? Wrap up: "Perfect, that's all I needed — thanks for your time, goodbye."`,
    `- Stay under two and a half minutes.`,
  ].join("\n");
}

// The opening line is editable, but it always has to say the call is
// automated — undisclosed AI calling is illegal in several states. If an edit
// drops the disclosure, this puts a short one back.
const DISCLOSED =
  /\b(automated|autodial|recorded|a\.? ?i\.?|artificial intelligence|robot|bot|virtual assistant|not a (?:real )?(?:human|person))\b/i;

export function ensureDisclosure(line) {
  const t = (line || "").trim();
  if (!t) return "";
  return DISCLOSED.test(t) ? t : `Hi, quick automated call — ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

export function buildCallBody({ phoneNumberId, to, carDescription, dealerName, voice, opening, rules }) {
  const first = ensureDisclosure(opening?.trim() || firstMessage(carDescription));
  const system = rules?.trim() || systemPrompt(carDescription, dealerName);
  return {
    phoneNumberId,
    customer: { number: to },
    assistant: {
      firstMessage: first,
      voice: { provider: "11labs", voiceId: voice.elevenLabsVoiceId, model: voice.vapiModel },
      model: {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.4,
        messages: [{ role: "system", content: system }],
      },
      maxDurationSeconds: 180,
      silenceTimeoutSeconds: 20,
      endCallPhrases: ["goodbye", "thanks for your time", "take you off the list"],
      analysisPlan: { summaryPlan: { enabled: true } },
    },
  };
}
