// Tiny JSON-file persistence. Everything lives in data/store.json.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = path.join(DATA_DIR, "store.json");

export function openStore() {
  mkdirSync(DATA_DIR, { recursive: true });
  let data;
  try {
    data = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    data = {};
  }
  data.campaigns ||= [];
  data.lastSearch ||= null;
  data.spend ||= 0;

  let saveTimer = null;
  const store = {
    data,
    save() {
      // Debounce: call-polling saves often.
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        writeFileSync(FILE, JSON.stringify(data, null, 2));
      }, 250);
    },
    addSpend(x) {
      data.spend = Math.round((data.spend + (x || 0)) * 10000) / 10000;
      store.save();
    },
  };
  return store;
}
