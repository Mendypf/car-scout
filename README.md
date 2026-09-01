# Car Scout

When you're shopping for a car online, the one thing a listing can't tell you
is whether the car is still there. Cars sell and stay posted for days, and
fresh trade-ins sit on the lot long before anyone lists them. The dealership
knows, you just have to call and ask, and nobody wants to spend an afternoon
calling twenty dealerships.

So that's what Car Scout does. You tell it what car you're looking for and it
searches the sites near you, and when you're ready, an AI gets on the phone
and calls the dealerships for you. It asks whether the car is on the lot right
now and what they're asking for it, and you get the answers back in one list,
with each conversation written out and the cost of the call next to it. A call
runs about 11 cents a minute, so calling ten dealerships costs a dollar or two.

The searching part is free. CARFAX and Craigslist are built in, and if you use
an AI agent like Claude Code or Cursor, it can read the sites that block
scrapers, Autotrader and CarGurus and the rest, and pour everything into the
same list. There's a plain dashboard in your browser, and an MCP server if
you'd rather let your agent run the whole thing.

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

Keep `npm start` running alongside it: the agent and the dashboard share one
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
| **ScrapeCreators** | adds Facebook Marketplace | [app.scrapecreators.com](https://app.scrapecreators.com), free to start, no card |

Paste them into **Add keys**, or use environment variables: see
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
field inventory questions all day. The disclosure costs you nothing and keeps
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

MIT, see [LICENSE](LICENSE).
