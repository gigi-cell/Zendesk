import { AUTO_REPLY_CATEGORIES } from "./policies.js";

const ZD_BASE  = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const ZD_EMAIL = process.env.ZENDESK_EMAIL;
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN;

function zdHeaders() {
  const credentials = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString("base64");
  return {
    "Content-Type": "application/json",
    "Authorization": `Basic ${credentials}`,
  };
}

function toTag(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Decide whether this ticket should be auto-replied or queued for human review.
 */
export function shouldAutoReply(claudeResult) {
  // Draft-only mode is the default production behavior.
  if (process.env.DRAFT_ONLY_MODE !== "false") return false;

  // Never auto-reply if a manual action is required
  if (claudeResult.escalate_to_whatsapp) return false;
  if (claudeResult.place_order_on_hold)  return false;
  if ((claudeResult.required_actions || []).length > 0) return false;

  // Environment override — set AUTO_REPLY_ALL=true to send everything
  if (process.env.AUTO_REPLY_ALL === "true") return true;

  return AUTO_REPLY_CATEGORIES.has(claudeResult.category);
}

/**
 * Main function — called by server.js for every incoming ticket.
 */
export async function updateZendeskTicket(ticketId, claudeResult) {
  const {
    category,
    priority,
    zendesk_priority,
    tags,
    required_actions,
    draft_response,
    internal_note,
    escalate_to_whatsapp,
    place_order_on_hold,
  } = claudeResult;

  const autoReply = shouldAutoReply(claudeResult);

  // ── Build tag list ────────────────────────────────────────────
  const ticketTags = [
    "ai_processed",
    autoReply ? "ai_auto_replied" : "ai_needs_review",
    toTag(category),
    ...(tags || []).map(toTag),
    ...(required_actions || []).map(toTag),
    ...(escalate_to_whatsapp ? ["escalate_whatsapp"] : []),
    ...(place_order_on_hold  ? ["order_on_hold"]     : []),
  ];

  // ── 1. Update ticket priority + tags ─────────────────────────
  const ticketUpdate = await fetch(`${ZD_BASE}/tickets/${ticketId}.json`, {
    method: "PUT",
    headers: zdHeaders(),
    body: JSON.stringify({
      ticket: {
        priority: zendesk_priority || priority.toLowerCase(),
        tags: ticketTags,
      },
    }),
  });

  if (!ticketUpdate.ok) {
    const err = await ticketUpdate.text();
    throw new Error(`ZenDesk ticket update failed (tags/priority): ${err}`);
  }

  if (autoReply) {
    // ── 2a. AUTO-SEND: public reply + solve ticket ──────────────
    console.log(`   ↳ Auto-replying (category: ${category})`);

    const replyUpdate = await fetch(`${ZD_BASE}/tickets/${ticketId}.json`, {
      method: "PUT",
      headers: zdHeaders(),
      body: JSON.stringify({
        ticket: {
          status: "solved",
          comment: {
            body: draft_response,
            public: true,   // ← sends to customer
          },
        },
      }),
    });

    if (!replyUpdate.ok) {
      const err = await replyUpdate.text();
      throw new Error(`ZenDesk auto-reply failed: ${err}`);
    }

    // ── 2b. Also add a brief internal note for the audit trail ──
    await fetch(`${ZD_BASE}/tickets/${ticketId}.json`, {
      method: "PUT",
      headers: zdHeaders(),
      body: JSON.stringify({
        ticket: {
          comment: {
            body: buildAuditNote({ category, priority, internal_note }),
            public: false,
          },
        },
      }),
    });

    console.log(`   ✅ Auto-reply sent & ticket solved`);

  } else {
    // ── 2c. DRAFT-ONLY / HUMAN REVIEW: internal note only ──────
    console.log(`   ↳ Draft-only review note added (category: ${category})`);

    const noteUpdate = await fetch(`${ZD_BASE}/tickets/${ticketId}.json`, {
      method: "PUT",
      headers: zdHeaders(),
      body: JSON.stringify({
        ticket: {
          status: "open",
          comment: {
            body: buildReviewNote({ category, priority, draft_response, internal_note, escalate_to_whatsapp, place_order_on_hold, required_actions }),
            public: false,
          },
        },
      }),
    });

    if (!noteUpdate.ok) {
      const err = await noteUpdate.text();
      throw new Error(`ZenDesk internal note failed: ${err}`);
    }

    console.log(`   ✅ Draft note added — awaiting agent review`);
  }
}

// ── Note builders ─────────────────────────────────────────────

/**
 * Minimal audit trail note added after an auto-reply is sent.
 */
function buildAuditNote({ category, priority, internal_note }) {
  return [
    "🤖 AUTO-REPLY SENT BY CAPGOWN AI AGENT",
    `📂 Category : ${category}`,
    `🚦 Priority  : ${priority}`,
    "",
    "─── Agent Note ──────────────────────────",
    internal_note,
    "─────────────────────────────────────────",
    "Ticket auto-solved. Reopen if customer replies.",
  ].join("\n");
}

/**
 * Full review note for tickets that need a human agent.
 */
function buildReviewNote({ category, priority, draft_response, internal_note, escalate_to_whatsapp, place_order_on_hold, required_actions = [] }) {
  const flags = [];
  if (escalate_to_whatsapp) flags.push("🔴 ESCALATE TO WHATSAPP TEAM");
  if (place_order_on_hold)  flags.push("⏸️  PLACE ORDER ON HOLD BEFORE REPLYING");

  return [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "🎓 CAPGOWN AI AGENT — REVIEW REQUIRED",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📂 Category : ${category}`,
    `🚦 Priority  : ${priority}`,
    "",
    ...(flags.length ? ["⚠️  ACTION REQUIRED BEFORE SENDING:", ...flags.map(f => `   ${f}`), ""] : []),
    ...(required_actions.length ? ["🛠 REQUIRED ACTIONS:", ...required_actions.map((action) => `   - ${action}`), ""] : []),
    "─── Internal Note ───────────────────────",
    internal_note,
    "",
    "─── Suggested Reply (edit & send) ───────",
    draft_response,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "⚡ Draft-only mode is enabled.",
    "   Edit the draft above, then send manually in Zendesk.",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}
