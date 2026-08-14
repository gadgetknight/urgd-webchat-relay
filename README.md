# UR Gadget Doctors — Website Chat Relay

A website visitor asks a question in the chat bubble → it's posted to the **`#website-chat`
Slack channel** → a technician (Jonathan) replies in the thread (voice-to-text works) → the reply
lands back in the visitor's chat. If no one replies in time, or it's after hours, the **AI answers**
from the Syncro knowledge base. Every answered Q&A is **logged and fed back into the vector DB** so
it keeps getting smarter. Prospects can leave their **name + contact** so no lead is lost.

```
Visitor ──/api/ask──▶ Relay ──▶ Slack #website-chat (thread)
   ▲                    │              │  technician replies in-thread
   │  /api/poll         │              ▼
   └──── answer ◀───────┴──/api/slack/events◀── Slack Events
                        └──▶ log Q&A ──▶ ingest_conversations.py ──▶ Pinecone
```

## Why Slack (not SMS)
Each conversation is its own Slack **thread**, so a technician's reply maps back to the exact visitor
automatically — many chats at once, no codes, no guessing. Voice-to-text on Slack mobile just works.

## Run locally (no accounts needed — mock mode)
```bash
cd webchat-relay
node test-flow.js     # full flow test with a simulated technician (9 checks)
node local-server.js  # then open http://localhost:3000 to try the widget
```
With no Slack/OpenAI keys set, it runs in **mock mode**: Slack calls are simulated and the AI is
skipped, so the whole flow is testable offline.

## Endpoints
| Route | Who calls it | Does |
|---|---|---|
| `POST /api/ask` | widget | relay question to Slack (or AI after-hours) |
| `GET /api/poll` | widget | check for the technician's answer (timeout → AI) |
| `POST /api/slack/events` | Slack | technician's reply → back to the visitor |
| `POST /api/lead` | widget | capture a prospect's name + contact |
| `GET/POST /api/config` | control panel | read/update settings (admin key) |
| `GET /api/conversations` | pipeline | export Q&A as JSONL for `ingest_conversations.py` |

## Go-live checklist (see ../docs/webchat-relay-golive.md)
1. Create a Slack app + bot token, subscribe to `message.channels`, invite it to `#website-chat`.
2. Deploy to Vercel; set env vars (Slack, OpenAI, Pinecone, Upstash, ADMIN_KEY).
3. Point the Slack app's Event URL at `https://YOUR-RELAY.vercel.app/api/slack/events`.
4. Add the widget script to WordPress.
5. Open `/admin.html` to set the channel + behavior.

## Feeding answers back into the DB
```bash
# pull logged conversations from the relay, then ingest (from the project root)
curl -H "X-Admin-Key: YOURKEY" https://YOUR-RELAY.vercel.app/api/conversations > data/conversations/relay.jsonl
python ingest_conversations.py
```
