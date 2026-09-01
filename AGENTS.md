# Car Scout, for the agent

You are working with someone who is shopping for a car. Car Scout gives you one
thing you cannot do yourself: **it makes phone calls to dealerships and brings
back what they said.** Everything else here exists to feed that.

Read this before your first tool call.

## Get it running

The MCP tools all talk to a local server. If a tool answers "Car Scout isn't
running", start it and try again:

```bash
cd car-scout && npm install && npm start     # http://localhost:4310
```

Calling needs a Vapi key. If `search_listings` works but `call_dealerships`
says a key is missing, tell the person to open http://localhost:4310, press
**Add keys**, and paste their Vapi API key — you cannot do that step for them.

## The shape of a good job

1. **Search.** `search_listings` covers CARFAX and Craigslist for free. It is
   deliberately not the whole internet.
2. **Do your own looking.** This is the part only you can do. Search the web
   the way you normally would — Autotrader, CarGurus, cars.com, dealer sites,
   local classifieds — and push what you find with `import_listings`. Those
   sites block servers but not you. Real listings only: never invent a car, a
   price, a mileage, or a phone number.
3. **Line up who to call.** `list_dealerships` shows who is already callable.
   `find_nearby_dealerships` adds every dealer on the map, which matters when
   the person wants a car nobody nearby has listed — a brand store can order
   one. Rows with `phone: null` are your job: find the real number on the
   dealer's own site and send it back with `import_dealerships`.
4. **Ask before dialing.** Show the person who you plan to call, roughly what
   it will cost (about $0.11 a minute, most calls run one to two minutes), and
   what the call will say — `preview_call_script` gives you the exact words.
   Wait for a clear yes. Then call with `confirmedByUser: true`.
5. **Report.** `campaign_status` returns a verdict per dealer (`has_it`, `no`,
   `voicemail`, `no_answer`, `unclear`), a summary, the full transcript and the
   exact charge. Lead with who has the car.

## Rules

- **Never call without permission.** Real phones ring and real money is spent.
  "Find me a car" is not permission to dial. Ask, wait, then set
  `confirmedByUser: true`. The tool refuses otherwise, and that refusal is a
  feature — do not try to work around it.
- **Never fabricate a listing or a phone number.** A made-up number means a
  stranger gets an AI call. If you are unsure a number is real, leave it out.
- **The call always says it is automated.** The wording is editable by the
  person, but the server puts a disclosure back if it goes missing. Do not
  frame the assistant as a human caller in anything you write.
- **Keep batches sane.** Twenty dealerships is a big call run and costs a few
  dollars. Suggest a shortlist rather than dialing everything in range.
- **Prices and mileage come from the source.** Report what the listing or the
  dealer said; do not estimate a car's value on your own and present it as data.

## What the person sees

Everything you do lands in their dashboard at http://localhost:4310 — your
imported listings are tagged "your agent", and calls appear live with
transcripts as they finish. It is worth telling them to keep that tab open.
