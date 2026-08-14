// ai.js — retrieval-augmented draft/fallback answers from the same Pinecone
// knowledge base the pipeline builds. Used to (a) suggest an answer to the tech
// in Slack and (b) answer the customer if no human replies before the timeout.
'use strict';

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const PINECONE_KEY = process.env.PINECONE_API_KEY || '';
const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'syncro-kb';
const EMBED_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT =
  "You are the friendly online assistant for UR Gadget Doctors, a device repair shop. " +
  "Answer the visitor's question warmly and concisely using ONLY the past repair history in the context. " +
  "Never correct the customer's wording or terminology. Never mention internal ticket numbers, other " +
  "customers, or personal information. You may give typical steps, turnaround, and past pricing, but note " +
  "final pricing depends on the specific device and its diagnosis. If the context does not cover it, say " +
  "you're not certain and invite them to call or bring the device in. End with a short friendly line " +
  "inviting them to rephrase or call if it wasn't what they needed.";

let indexHost = null;
async function getIndexHost() {
  if (indexHost) return indexHost;
  const r = await fetch(`https://api.pinecone.io/indexes/${INDEX_NAME}`, {
    headers: { 'Api-Key': PINECONE_KEY, 'X-Pinecone-API-Version': '2025-01' },
  });
  const j = await r.json();
  indexHost = j.host;
  return indexHost;
}

async function embed(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  const j = await r.json();
  return j.data[0].embedding;
}

async function retrieve(question, topK = 5) {
  const host = await getIndexHost();
  const vector = await embed(question);
  const r = await fetch(`https://${host}/query`, {
    method: 'POST',
    headers: { 'Api-Key': PINECONE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector, topK, includeMetadata: true }),
  });
  const j = await r.json();
  return (j.matches || []).map((m) => (m.metadata && m.metadata.text) || '').filter(Boolean);
}

async function chat(system, user) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL, temperature: 0.2,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const j = await r.json();
  return j.choices && j.choices[0] ? j.choices[0].message.content.trim() : '';
}

// Best-effort. Returns null if AI isn't configured (keeps the relay working in
// local/mock mode without keys).
async function draftAnswer(question) {
  if (!OPENAI_KEY || !PINECONE_KEY) return null;
  try {
    const context = (await retrieve(question)).join('\n\n---\n\n') || '(no matching history)';
    return await chat(SYSTEM_PROMPT, `Context:\n${context}\n\nQuestion: ${question}`);
  } catch (e) {
    console.error('draftAnswer error:', e.message);
    return null;
  }
}

module.exports = { draftAnswer };
