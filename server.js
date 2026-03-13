import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { classifyAndDraft } from "./openai.js";
import { shouldAutoReply, updateZendeskTicket } from "./zendesk.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.join(__dirname, "assets");
const publicDir = path.join(__dirname, "public");

app.use(express.json());
app.use(express.static(publicDir));
app.use("/assets", express.static(assetsDir));
app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-zendesk-webhook-signature, x-zendesk-webhook-signature-timestamp");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});

app.options("*", (_req, res) => {
  res.status(204).end();
});

// ── Signature verification ────────────────────────────────────
// ZenDesk signs every webhook payload with HMAC-SHA256.
// Set ZENDESK_WEBHOOK_SECRET in your environment.
function verifySignature(req) {
  const secret = process.env.ZENDESK_WEBHOOK_SECRET;
  if (!secret) return true; // skip in local dev if not set

  const signature = req.headers["x-zendesk-webhook-signature"];
  const timestamp = req.headers["x-zendesk-webhook-signature-timestamp"];
  if (!signature || !timestamp) return false;

  const body = JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + body)
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", service: "capgown-cs-webhook" }));
app.get("/", (_req, res) => res.redirect("/portal.html"));
app.get("/portal", (_req, res) => res.redirect("/portal.html"));

function normalizeTicket(ticket = {}) {
  const tags = normalizeTags(ticket.tags);
  const orderTag = tags.find((tag) => tag.startsWith("order_")) || "";

  return {
    ticketId: ticket.id || null,
    customerName: ticket.requester?.name || ticket.requesterName || ticket.requester_name || "Customer",
    orderNumber: ticket.orderNumber || orderTag.replace("order_", "#") || "N/A",
    subject: ticket.subject || ticket.title || "",
    body: ticket.description || ticket.comment || ticket.latest_comment?.body || ticket.body || "",
    tags,
  };
}

function normalizeTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags.filter(Boolean).map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof rawTags === "string") {
    return rawTags
      .split(/[,\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function decorateResult(result) {
  return {
    ...result,
    auto_reply: shouldAutoReply(result),
  };
}

app.post("/api/analyze", async (req, res) => {
  try {
    const ticket = normalizeTicket(req.body?.ticket || req.body);
    const result = await classifyAndDraft(ticket);
    res.json({ ok: true, result: decorateResult(result) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Main webhook endpoint ─────────────────────────────────────
app.post("/webhook/zendesk", async (req, res) => {
  // 1. Verify signature
  if (!verifySignature(req)) {
    console.warn("⚠️  Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Acknowledge immediately — ZenDesk expects a fast 200
  res.status(200).json({ received: true });

  // 2. Pull ticket data out of the ZenDesk payload
  const payload = req.body;
  const ticket = payload?.ticket;
  if (!ticket) {
    console.warn("No ticket object in payload", payload);
    return;
  }

  const normalized = normalizeTicket(ticket);
  const ticketId = normalized.ticketId;
  const subject = normalized.subject;

  console.log(`\n📩 Ticket #${ticketId} received — "${subject}"`);

  // 3. Skip tickets that already have an AI draft tag (prevent re-processing)
  if (normalized.tags.includes("ai_processed")) {
    console.log(`   ↳ Already processed, skipping.`);
    return;
  }

  try {
    console.log(`   ↳ Sending to OpenAI…`);
    const result = await classifyAndDraft(normalized);

    console.log(`   ↳ Category: ${result.category} | Priority: ${result.priority}`);

    // 5. Write back to ZenDesk
    await updateZendeskTicket(ticketId, result);
    console.log(`   ✅ Ticket #${ticketId} updated in ZenDesk`);
  } catch (err) {
    console.error(`   ❌ Error processing ticket #${ticketId}:`, err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎓 CAPGOWN CS Webhook running on port ${PORT}`);
  console.log(`   POST /api/analyze`);
  console.log(`   POST /webhook/zendesk`);
  console.log(`   GET  /health\n`);
});

export default app;
