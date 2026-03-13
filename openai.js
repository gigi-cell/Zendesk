import { CAPGOWN_RESPONSE_BLUEPRINT, CAPGOWN_CATEGORY_GUIDANCE, CAPGOWN_INTERNAL_BEHAVIOR } from "./knowledge-base.js";
import { CAPGOWN_POLICY_SUMMARY, CATEGORY_NAMES } from "./policies.js";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

const RESPONSE_SCHEMA = {
  name: "capgown_ticket_triage",
  strict: true,
  schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: CATEGORY_NAMES,
      },
      priority: {
        type: "string",
        enum: ["Urgent", "High", "Normal", "Low"],
      },
      zendesk_priority: {
        type: "string",
        enum: ["urgent", "high", "normal", "low"],
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
      },
      required_actions: {
        type: "array",
        items: {
          type: "string",
        },
      },
      customer_stage: {
        type: "string",
        enum: ["placed_order", "prospect", "unknown"],
      },
      draft_response: {
        type: "string",
      },
      internal_note: {
        type: "string",
      },
      escalate_to_whatsapp: {
        type: "boolean",
      },
      place_order_on_hold: {
        type: "boolean",
      },
    },
    required: [
      "category",
      "priority",
      "zendesk_priority",
      "tags",
      "required_actions",
      "customer_stage",
      "draft_response",
      "internal_note",
      "escalate_to_whatsapp",
      "place_order_on_hold",
    ],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = [
  "You are CAPGOWN's customer service triage and drafting agent.",
  "Your job is to classify each customer inquiry into exactly one CAPGOWN support category, assign the right priority, produce a safe draft response, and add a short internal note for the human support team.",
  "",
  "Hard rules:",
  "- Follow CAPGOWN policy exactly. Do not invent refunds, shipping promises, or exception approvals.",
  "- If a case needs manual action, keep the draft helpful but avoid implying the action is already complete.",
  "- Never say an invoice, tracking lookup, return label, preorder link, refund, cancellation, carrier claim, address update, email update, or size update has already been completed unless the ticket context explicitly says it has already been completed.",
  "- If the ceremony is within 7 days, fraud is suspected, or international delivery failed, use Urgent priority.",
  "- If the ceremony is within 14 days, an item is missing, a defect is reported, or the wrong item shipped, use High priority unless Urgent applies.",
  "- Use Normal for routine exchanges, returns, or standard shipping questions.",
  "- Use Low for general informational requests like tax, invoices, general sizing, and gender-neutral fit questions.",
  "- Keep tags lowercase with underscores only.",
  "- Exchanges are not available internationally.",
  "- For returns, distinguish quality issues from change-of-mind returns. Do not promise a free label for change-of-mind returns.",
  "- For fraud alerts, require verification details and indicate the order should remain on hold until verified.",
  "- For premium black hood or piping issues, the order must remain on hold until missing details are confirmed.",
  "- For international delivery failures, tell the customer they need to provide a valid phone number and contact the carrier.",
  "- For pre-orders, ask for the missing size / tam / tassel details or note that support will send a purchase link. Do not invent a purchase link.",
  "- For invoice requests, say support can send or attach the invoice. Do not pretend the attachment is already included.",
  "- For order updates, phrase the response as assistance or pending confirmation unless the ticket explicitly says the update was completed.",
  "- Use required_actions to list concrete follow-up steps such as attach_invoice, attach_sizing_guide, attach_return_label, update_order_record, provide_preorder_link, verify_identity, contact_fulfillment, contact_whatsapp_team, file_carrier_claim, customer_contact_carrier, collect_missing_details, or confirm_return_status.",
  "- Set customer_stage to placed_order when the customer already has an order, prospect when they are shopping before purchase, and unknown otherwise.",
  "- Draft responses should be warm, concise, and normally under 200 words.",
  "- If it is a natural close to the conversation, you may include EFRAME10 for customers who already ordered or HENRIETTA10 for prospects. Do not force a discount code into every reply.",
  '- Sign replies exactly with: Best regards,\\n[CAPGOWN Customer Service]',
  "",
  "Response blueprint:",
  ...CAPGOWN_RESPONSE_BLUEPRINT.map((line) => `- ${line}`),
  "",
  "Category-specific guidance:",
  ...CAPGOWN_CATEGORY_GUIDANCE.map((line) => `- ${line}`),
  "",
  "Internal operating behavior:",
  ...CAPGOWN_INTERNAL_BEHAVIOR.map((line) => `- ${line}`),
  "",
  "CAPGOWN policies:",
  ...CAPGOWN_POLICY_SUMMARY.map((line) => `- ${line}`),
].join("\n");

function buildUserMessage({ customerName, orderNumber, subject, body, tags = [] }) {
  return [
    `Customer name: ${customerName || "Customer"}`,
    `Order number: ${orderNumber || "N/A"}`,
    `Subject: ${subject || ""}`,
    `Existing tags: ${tags.join(", ") || "none"}`,
    "",
    "Customer message:",
    body || "",
  ].join("\n");
}

function extractTextPayload(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data.output || []) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("").trim();
}

export async function classifyAndDraft(ticket) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: buildUserMessage(ticket) }],
        },
      ],
      reasoning: { effort: "medium" },
      max_output_tokens: 1200,
      text: {
        format: {
          type: "json_schema",
          ...RESPONSE_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const raw = extractTextPayload(data);

  if (!raw) {
    throw new Error("OpenAI response did not include structured text output.");
  }

  return JSON.parse(raw);
}
