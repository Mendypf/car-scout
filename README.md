# Car Scout

Car listings go stale. A car sells on Saturday and sits on the site until
Wednesday; a fresh trade-in sits on the lot for days before it shows up
anywhere. The only way to know what a dealership actually has is to call and
ask.

Car Scout does the calling. You search, pick who to ask, and an AI phones each
dealership: is the car physically on the lot, what are you asking for it, what
are the miles. You get a list back — **has it**, **doesn't have it**, **no
answer** — with the full transcript and the exact cost of every call.

And it searches the whole market, not one site. Free built-in feeds cover
CARFAX and Craigslist; your own agent reads everything else, Autotrader and
CarGurus and cars.com included, and feeds what it finds into the same list.

It runs two ways: a dashboard in your browser, and an **MCP server** so your
own agent (Claude Code, Cursor, anything that speaks MCP) can drive the whole
thing and do the searching on the subscription you already pay for.

## Quick start

Node.js 18 or newer.

```bash
git clone https://github.com/Mendypf/car-scout.git
cd car-scout
npm install
npm start                  # http://localhost:4310
```

Searching works immediately, with no account and no key. To make calls, open
the dashboard, press **Add keys**, and paste a Vapi API key.

### Plug it into your agent

```bash
# Claude Code
claude mcp add car-scout -- node /full/path/to/car-scout/mcp-server.js

# any other MCP client
command: node    args: ["/full/path/to/car-scout/mcp-server.js"]
```

Keep `npm start` running alongside it — the agent and the dashboard share one
state, so everything the agent does appears on screen. [AGENTS.md](AGENTS.md)
is written for the agent itself; point yours at it.

## What it costs

| | |
|---|---|
| Searching (built-in feeds + everything your agent reads) | free |
| Finding dealerships to call | free |
| Hearing the call before you send it | free |
| A phone call | about $0.11 a minute, most run 1–2 minutes |
| Facebook Marketplace (optional) | about $0.002 a search |

Calling twenty dealerships lands around $2–6. Voicemail and unanswered calls
cost cents. Every number is on screen before you spend it, and each call's real
charge replaces the estimate the moment it ends.

## Keys

| Key | For | Where |
|---|---|---|
| **Vapi** | the phone calls | [dashboard.vapi.ai](https://dashboard.vapi.ai) → API Keys, plus a phone number on the account |
| **Vapi public key** | hearing the call in your browser | same page, labeled Public Key |
| **ScrapeCreators** | adds Facebook Marketplace | [app.scrapecreators.com](https://app.scrapecreators.com) — free to start, no card |

Paste them into **Add keys**, or use environment variables — see
[`.env.example`](.env.example). Pasted keys live in `data/config.json`, which is
gitignored. Treat that file like a password.

## Where listings come from

The whole market, split between the app and your agent:

- **Your agent reads every site.** Autotrader, CarGurus, cars.com, CarMax,
  dealer sites, local classifieds: those sites block server scrapers, but not
  an agent browsing on the subscription you already pay for. It pushes what it
  finds in with `import_listings` and the results show up in the dashboard
  tagged "your agent", alongside everything else.
- **Built-in free feeds run on every search**: CARFAX, new and used, straight
  from the public API its own site uses, every row carrying the dealer's phone
  number, and Craigslist for private sellers and small lots.
- **Facebook Marketplace** joins in if you add a ScrapeCreators key.

Dealerships to call come from those listings (free), from OpenStreetMap for
every other dealer nearby (free), and from your agent.

## The calls

- Every call opens by saying it's automated, then asks the one question.
- It asks whether the car is **physically on the lot**, the **asking price**,
  the **mileage**, and if they don't have it, whether they can get one.
- It never claims to be a person, never negotiates, never gives out your details.
- "Take me off the list" ends the call on the spot.
- Voicemail gets a hang-up, not a message. Three minutes, hard capped.
- You can rewrite the opening line and the whole script before sending it, and
  hear it in your browser first.

**One thing you shouldn't remove.** The disclosure that the call is automated
gets put back by the server if an edit drops it. Undisclosed AI calling is
illegal in several US states, and these are business calls to dealerships that
field inventory questions all day — the disclosure costs you nothing and keeps
you clear.

## Trying it without calling anyone

`test/mock-vapi.js` stands in for Vapi and walks calls through scripted
outcomes, so the whole pipeline runs without dialing a real number.

```bash
npm run mock            # terminal 1
npm run start:mock      # terminal 2
```

Call any three dealerships and the board shows *has it*, *doesn't have it* and
*voicemail*, each with its own cost.

## MCP tools

| Tool | Does |
|---|---|
| `search_listings` | CARFAX + Craigslist (+ Facebook if keyed) |
| `import_listings` | push listings the agent found itself |
| `list_dealerships` | who is callable right now |
| `find_nearby_dealerships` | every dealer on the map near a ZIP |
| `import_dealerships` | push dealers the agent found itself |
| `preview_call_script` | the exact words the call will use |
| `call_dealerships` | places real calls; refuses without the user's explicit yes |
| `campaign_status` | verdicts, summaries, transcripts, per-call cost |

## Layout

```
server.js          Express app + JSON API
mcp-server.js      MCP server for your agent
AGENTS.md          Instructions written for the agent
lib/config.js      Keys and the price table, read by the UI
lib/vapi.js        Vapi client, the opening line, the call's rules
lib/calls.js       Runs a batch of calls, reads transcripts, scores answers
lib/sources.js     CARFAX + Craigslist (free), Facebook Marketplace
lib/dealers.js     Who is callable: listings, OpenStreetMap, agent imports
lib/geo.js         ZIP to coordinates
lib/store.js       JSON file persistence (data/)
public/            The dashboard
test/mock-vapi.js  Fake Vapi for end-to-end testing
```

## License

MIT — see [LICENSE](LICENSE).
