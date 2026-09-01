// A stand-in for Vapi, so the calling pipeline can be exercised without
// dialing real dealerships. It answers the three endpoints Car Scout uses and
// walks each call through queued -> in-progress -> ended with a scripted
// transcript, so the classifier, the cost accounting and the board can all be
// checked against known answers.
//
//   node test/mock-vapi.js                 # terminal 1, port 4399
//   VAPI_BASE_URL=http://localhost:4399 npm start   # terminal 2

import express from "express";

const app = express();
app.use(express.json());

const calls = new Map();

// Three dealers, three outcomes we want the app to get right.
const SCRIPTS = [
  {
    match: /has/i,
    endedReason: "customer-ended-call",
    transcript:
      "AI: Hi, this is an automated call on behalf of a local car buyer. Quick question: do you have a used 2020 or newer Toyota Camry under $25,000 available right now?\n" +
      "Dealer: Yeah, we do have one on the lot, a 2021 SE with 41,000 miles, asking $22,400.\n" +
      "AI: That's helpful, thank you. Is it available today?\n" +
      "Dealer: It is, come by any time.\n" +
      "AI: Thanks for your time, goodbye.",
    summary: "They have a 2021 Camry SE, 41,000 miles, $22,400, on the lot today.",
    expect: "has_it",
  },
  {
    match: /no/i,
    endedReason: "assistant-ended-call",
    transcript:
      "AI: Hi, this is an automated call on behalf of a local car buyer. Do you have a used 2020 or newer Toyota Camry under $25,000?\n" +
      "Dealer: Sorry, we don't have any Camrys right now, we sold the last one.\n" +
      "AI: Understood, thanks for your time, goodbye.",
    summary: "No Camry in stock.",
    expect: "no",
  },
  {
    match: /voicemail/i,
    endedReason: "voicemail",
    transcript: "",
    summary: null,
    expect: "voicemail",
  },
];

app.get("/phone-number", (_req, res) =>
  res.json([{ id: "mock-number-1", number: "+15550001111", name: "Mock line" }])
);

app.post("/call", (req, res) => {
  const prompt = req.body?.assistant?.model?.messages?.[0]?.content || "";
  const dealer = /calling ([^,]+), a car dealership/.exec(prompt)?.[1] || "";
  // A dealer named "has…", "no…" or "voicemail…" picks its outcome; any other
  // name rotates through the outcomes so a demo run still shows variety.
  const script = SCRIPTS.find((s) => s.match.test(dealer)) || SCRIPTS[calls.size % SCRIPTS.length];
  const id = `mock_${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = new Date();
  calls.set(id, { id, script, startedAt, endsAt: Date.now() + 9000 });
  // Echo back what a real create returns.
  res.json({ id, status: "queued", createdAt: startedAt.toISOString() });
});

app.get("/call/:id", (req, res) => {
  const c = calls.get(req.params.id);
  if (!c) return res.status(404).json({ message: "no such call" });
  if (Date.now() < c.endsAt) return res.json({ id: c.id, status: "in-progress" });
  const seconds = 74;
  res.json({
    id: c.id,
    status: "ended",
    endedReason: c.script.endedReason,
    startedAt: c.startedAt.toISOString(),
    endedAt: new Date(c.startedAt.getTime() + seconds * 1000).toISOString(),
    cost: c.script.endedReason === "voicemail" ? 0.01 : 0.14,
    transcript: c.script.transcript,
    analysis: { summary: c.script.summary },
    recordingUrl: null,
  });
});

app.listen(4399, () => console.log("mock vapi → http://localhost:4399"));
