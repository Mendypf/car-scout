// Keys and prices in one place. Keys come from the environment or from the
// settings box in the dashboard (saved to data/config.json, which is gitignored).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = path.join(DATA_DIR, "config.json");

let saved = {};
try {
  saved = JSON.parse(readFileSync(FILE, "utf8"));
} catch {
  saved = {};
}

export const config = {
  get vapiKey() {
    return process.env.VAPI_API_KEY || saved.vapiKey || "";
  },
  get vapiPhoneNumberId() {
    return process.env.VAPI_PHONE_NUMBER_ID || saved.vapiPhoneNumberId || "";
  },
  // Safe to hand to the browser — it is the key Vapi expects client-side.
  get vapiPublicKey() {
    return process.env.VAPI_PUBLIC_KEY || saved.vapiPublicKey || "";
  },
  get scrapeCreatorsKey() {
    return process.env.SCRAPECREATORS_API_KEY || saved.scrapeCreatorsKey || "";
  },
  set(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === "string" && v.trim()) saved[k] = v.trim();
      else if (v === null) delete saved[k];
    }
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(saved, null, 2));
  },
};

// The voice on every call: ElevenLabs "Chris — charming, down-to-earth", a
// casual American male that reads as a person calling, not a system.
export const VOICE = {
  elevenLabsVoiceId: "iP95p4xoKVk53GoZ742B",
  vapiModel: "eleven_turbo_v2_5", // low latency on live calls
};

// Every charge this app can make, in one table. The dashboard reads these so
// the numbers on screen are the numbers that get billed.
export const PRICES = {
  search: {
    "carfax-used": 0, // fetched directly from CARFAX's public API
    "carfax-new": 0,
    craigslist: 0, // fetched directly from Craigslist's public API
    facebook: 0.00188, // 1 ScrapeCreators credit at the $47/25k rate
  },
  // Vapi bills per minute (platform fee plus the model, voice, transcription
  // and telephony it passes through). The exact charge for each call comes
  // back from Vapi when the call ends; this is only for the up-front estimate.
  callPerMinuteEstimate: 0.11,
  callTypicalMinutes: 1.5,
  callMaxMinutes: 3,
};
