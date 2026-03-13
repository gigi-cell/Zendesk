#!/usr/bin/env python3
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
PORTAL_FILE = PUBLIC_DIR / "portal.html"
INDEX_FILE = PUBLIC_DIR / "index.html"
OPENAI_URL = "https://api.openai.com/v1/responses"
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")

CATEGORY_NAMES = [
    "Exchange",
    "Shipping",
    "Sizing",
    "Order Update",
    "Return",
    "Refund/Cancellation",
    "Out of Stock",
    "Rental",
    "Rental Keeper",
    "Invoice/Receipt",
    "Gender Neutral Inquiry",
    "Tax Exemption",
    "Missing Garment Bag",
    "No Local Office",
    "Pre-Order",
    "Fraud Alert",
    "Hood/Piping Verification",
    "International Delivery",
]

AUTO_REPLY_CATEGORIES = {
    "Sizing",
    "Gender Neutral Inquiry",
    "No Local Office",
}

CAPGOWN_POLICY_SUMMARY = [
    "Exchanges are accepted for incorrect size, defects, or fulfillment errors, but international exchanges are not offered.",
    "Quality-related returns may receive a free return label. Change-of-mind returns should not be promised a free return label.",
    "CAPGOWN has no physical office; service is online only at capgown.com.",
    "Pre-orders usually require size, tam size, tassel details, and a manually generated purchase link.",
    "Rental customers typically receive regalia 2-3 weeks before the ceremony and return it about 7 days after the event.",
    "Rental Keeper requests only apply when there is an associated rental order.",
    "Fraud-alert orders should remain on hold until order number, purchase date, last four card digits, and billing address are verified.",
    "Premium Black hood or piping concerns require the order to be placed on hold before replying.",
    "If international delivery fails, the customer needs to update their phone number and contact the carrier.",
    "Sizing guidance should use the sizing guide and shoulder-to-floor height. CAPGOWN does not offer tailoring or XXS sizing.",
]

SYSTEM_PROMPT = "\n".join(
    [
        "You are CAPGOWN's customer service triage and drafting agent.",
        "Classify each inquiry into exactly one CAPGOWN support category, assign the correct priority, produce a safe draft response, and add a short internal note.",
        "",
        "Hard rules:",
        "- Follow CAPGOWN policy exactly. Do not invent refunds, shipping promises, or exception approvals.",
        "- Never say an invoice, tracking lookup, return label, preorder link, refund, cancellation, carrier claim, address update, email update, or size update has already been completed unless the ticket context explicitly says it has already been completed.",
        "- If the ceremony is within 7 days, fraud is suspected, or international delivery failed, use Urgent priority.",
        "- If the ceremony is within 14 days, an item is missing, a defect is reported, or the wrong item shipped, use High priority unless Urgent applies.",
        "- Keep tags lowercase with underscores only.",
        "- Exchanges are not available internationally.",
        "- For returns, distinguish quality issues from change-of-mind returns. Do not promise a free label for change-of-mind returns.",
        "- For fraud alerts, require verification details and indicate the order should remain on hold until verified.",
        "- For premium black hood or piping issues, the order must remain on hold until missing details are confirmed.",
        "- For international delivery failures, tell the customer they need to provide a valid phone number and contact the carrier.",
        "- For pre-orders, ask for the missing size / tam / tassel details or note that support will send a purchase link. Do not invent a purchase link.",
        "- For invoice requests, say support can send or attach the invoice. Do not pretend the attachment is already included.",
        "- Use required_actions to list concrete follow-up steps such as attach_invoice, attach_sizing_guide, attach_return_label, update_order_record, provide_preorder_link, verify_identity, contact_fulfillment, contact_whatsapp_team, file_carrier_claim, customer_contact_carrier, collect_missing_details, or confirm_return_status.",
        '- Sign replies exactly with: Best regards,\\n[CAPGOWN Customer Service]',
        "",
        "CAPGOWN policies:",
        *[f"- {line}" for line in CAPGOWN_POLICY_SUMMARY],
    ]
)


def infer_customer_stage(ticket):
    subject = (ticket.get("subject") or "").lower()
    body = (ticket.get("body") or "").lower()
    order_number = (ticket.get("orderNumber") or "").strip()
    if order_number and order_number not in {"N/A", "#N/A"}:
        return "placed_order"
    if any(term in body or term in subject for term in ["thinking of ordering", "considering ordering", "before i buy", "before ordering", "do you carry", "available in my size"]):
        return "prospect"
    return "unknown"


def contains_any(text, terms):
    return any(term in text for term in terms)


def build_mock_result(ticket):
    subject = (ticket.get("subject") or "").lower()
    body = (ticket.get("body") or "").lower()
    text = f"{subject}\n{body}"
    customer_stage = infer_customer_stage(ticket)
    required_actions = []
    escalate_to_whatsapp = False
    place_order_on_hold = False
    tags = []

    if contains_any(text, ["fraud", "chargeback", "verify card", "verification"]) or contains_any(text, ["last 4 digits", "billing address"]) :
        category = "Fraud Alert"
        priority = "Urgent"
        zendesk_priority = "urgent"
        place_order_on_hold = True
        required_actions = ["verify_identity", "update_order_record"]
        tags = ["fraud_alert", "manual_review"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for your patience. To protect your order, we need to verify a few details before shipment. "
            "Please reply with your order number, purchase date, the last four digits of the card used, and the billing address associated with the order.\n\n"
            "Once we receive that information, our team will review it as quickly as possible.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["international", "fedex country", "carrier cannot contact", "phone number", "returned by carrier", "london"]) and contains_any(text, ["deliver", "delivery", "courier", "carrier", "package"]):
        category = "International Delivery"
        priority = "Urgent"
        zendesk_priority = "urgent"
        required_actions = ["customer_contact_carrier", "collect_missing_details"]
        tags = ["international_delivery", "carrier_issue"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. It looks like the carrier is unable to complete delivery without a valid contact number. "
            "Please reply with the best phone number for delivery and contact the carrier directly to arrange delivery as soon as possible.\n\n"
            "If you share the updated number with us, our team can note it on the order as well.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["tracking", "where is my package", "label created", "lost package", "carrier delay", "shipment", "shipped too early"]):
        category = "Shipping"
        priority = "High" if contains_any(text, ["next friday", "next week", "ceremony", "urgent", "asap"]) else "Normal"
        zendesk_priority = priority.lower()
        escalate_to_whatsapp = contains_any(text, ["ceremony", "urgent", "asap", "tomorrow", "next friday"])
        required_actions = ["contact_fulfillment"] + (["contact_whatsapp_team"] if escalate_to_whatsapp else [])
        tags = ["shipping_issue"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We understand the urgency and our team is reviewing the shipping status of your order now. "
            "We will follow up with the most accurate tracking or carrier update as soon as possible.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["exchange", "too small", "too big", "wrong size", "wrong item", "defect"]):
        category = "Exchange"
        priority = "High" if contains_any(text, ["next friday", "next week", "ceremony", "urgent", "asap"]) else "Normal"
        zendesk_priority = priority.lower()
        required_actions = ["update_order_record", "contact_fulfillment"]
        tags = ["exchange_request"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We can help review your exchange request for the item that did not arrive in the right fit or condition. "
            "Our team will confirm the available replacement options and next steps with you shortly.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["invoice", "receipt", "itemized receipt", "reimbursement"]):
        category = "Invoice/Receipt"
        priority = "Low"
        zendesk_priority = "low"
        required_actions = ["attach_invoice"]
        tags = ["invoice_request"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We can help with a copy of your invoice or receipt for your order. "
            "Our support team will send the document to you as soon as possible.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["gender neutral", "unisex", "male or female"]):
        category = "Gender Neutral Inquiry"
        priority = "Low"
        zendesk_priority = "low"
        tags = ["gender_neutral"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. All of our regalia is unisex and gender-neutral, and we do not categorize products by gender.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["no office", "physical location", "store near me", "in-house office"]):
        category = "No Local Office"
        priority = "Low"
        zendesk_priority = "low"
        tags = ["online_only"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. CAPGOWN does not currently operate a physical office or in-house school location, but you are welcome to place your order through our website.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["pre-order", "preorder"]) or (contains_any(text, ["out of stock", "sold out", "not available"]) and customer_stage != "placed_order"):
        category = "Pre-Order"
        priority = "Low"
        zendesk_priority = "low"
        required_actions = ["provide_preorder_link", "collect_missing_details"]
        tags = ["preorder_interest"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We may be able to help with a pre-order if the requested regalia is not currently available. "
            "Please share your requested gown size, tam size, and tassel preference, and our team can review the next steps and send a purchase link if available.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["out of stock", "sold out", "not available", "do not carry"]):
        category = "Out of Stock"
        priority = "Normal"
        zendesk_priority = "normal"
        required_actions = ["collect_missing_details"]
        tags = ["inventory_issue"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We are reviewing the inventory situation for the regalia you requested. "
            "Depending on availability, we may be able to offer an alternative size, black regalia, a partial refund option, a pre-order, or cancellation.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["return", "send back", "refund label", "change of plans"]):
        category = "Return"
        priority = "Normal"
        zendesk_priority = "normal"
        if contains_any(text, ["quality issue", "defect", "damaged", "wrong item"]):
            required_actions = ["attach_return_label"]
            tags = ["quality_return"]
        else:
            required_actions = ["confirm_return_status"]
            tags = ["return_request"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We can help review the return options for your order. "
            "If the item has a quality issue, our team can review the return-label path; if the return is due to a change of plans, we will outline the return instructions for you.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["cancel", "cancellation", "refund"]):
        category = "Refund/Cancellation"
        priority = "Normal"
        zendesk_priority = "normal"
        required_actions = ["update_order_record"]
        tags = ["refund_request"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. Our team is reviewing your refund or cancellation request based on the current order status and timing. "
            "We will follow up with the available options shortly.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["rental keeper", "keep my rental"]):
        category = "Rental Keeper"
        priority = "Normal"
        zendesk_priority = "normal"
        required_actions = ["update_order_record", "collect_missing_details"]
        tags = ["rental_keeper"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We can help review your rental keeper request. "
            "Our team will confirm the related rental order and share the correct next step or school-specific link if applicable.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["rental", "ceremony date", "return my rental", "rental return"]):
        category = "Rental"
        priority = "Normal"
        zendesk_priority = "normal"
        if contains_any(text, ["return", "sent back", "received package", "late fee", "did not return"]):
            required_actions = ["confirm_return_status"]
        tags = ["rental"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. CAPGOWN rentals are typically shipped a few weeks before the ceremony date, and rental regalia is usually returned about 7 days after the event. "
            "If you need help with a return or ceremony-date question, our team can review the details with you.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["hood color", "gown piping", "premium black", "piping selection"]):
        category = "Hood/Piping Verification"
        priority = "High"
        zendesk_priority = "high"
        place_order_on_hold = True
        required_actions = ["collect_missing_details", "update_order_record"]
        tags = ["hood_piping"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for your order. We need to confirm your hood color and gown piping selection before we can proceed. "
            "Please reply with the missing selection details at your earliest convenience.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["garment bag", "carrying case", "bag missing"]):
        category = "Missing Garment Bag"
        priority = "High"
        zendesk_priority = "high"
        required_actions = ["contact_fulfillment"]
        tags = ["missing_bag"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out, and we are sorry to hear the garment bag or carrying case was missing. "
            "Our team will review the fulfillment details and follow up on the next step as quickly as possible.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["tax exempt", "tax exemption", "sales tax"]):
        category = "Tax Exemption"
        priority = "Low"
        zendesk_priority = "low"
        required_actions = ["collect_missing_details"]
        tags = ["tax_exemption"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. Our team can review your tax-exemption question and let you know what information or documentation may be needed.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    elif contains_any(text, ["address update", "change my address", "change my email", "update my email", "shipping address", "email address"]):
        category = "Order Update"
        priority = "Normal"
        zendesk_priority = "normal"
        required_actions = ["update_order_record"]
        tags = ["order_update"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We can help review the requested order update and our team will confirm the change after checking the order details.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )
    else:
        category = "Sizing"
        priority = "Low"
        zendesk_priority = "low"
        required_actions = ["attach_sizing_guide"]
        tags = ["sizing_help"]
        draft = (
            "Dear Customer,\n\n"
            "Thank you for reaching out. We recommend selecting gown sizing based on shoulder-to-floor height and reviewing the CAPGOWN sizing guide for the best fit. "
            "If you still need help, our team can review your sizing questions with you.\n\n"
            "Best regards,\n[CAPGOWN Customer Service]"
        )

    internal_note = (
        f"Mock analysis mode. Category={category}, priority={priority}. "
        f"Manual follow-up: {', '.join(required_actions) if required_actions else 'none'}."
    )

    return {
        "category": category,
        "priority": priority,
        "zendesk_priority": zendesk_priority,
        "tags": tags,
        "required_actions": required_actions,
        "customer_stage": customer_stage,
        "draft_response": draft,
        "internal_note": internal_note,
        "escalate_to_whatsapp": escalate_to_whatsapp,
        "place_order_on_hold": place_order_on_hold,
    }


def should_auto_reply(result):
    if result.get("escalate_to_whatsapp"):
        return False
    if result.get("place_order_on_hold"):
        return False
    if result.get("required_actions"):
        return False
    return result.get("category") in AUTO_REPLY_CATEGORIES


def call_openai(ticket):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None

    user_message = "\n".join(
        [
            f"Customer name: {ticket.get('customerName') or 'Customer'}",
            f"Order number: {ticket.get('orderNumber') or 'N/A'}",
            f"Subject: {ticket.get('subject') or ''}",
            f"Existing tags: {', '.join(ticket.get('tags') or []) or 'none'}",
            "",
            "Customer message:",
            ticket.get("body") or "",
        ]
    )

    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": [{"type": "input_text", "text": SYSTEM_PROMPT}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": user_message}],
            },
        ],
        "reasoning": {"effort": "medium"},
        "max_output_tokens": 1200,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "capgown_ticket_triage",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "enum": CATEGORY_NAMES},
                        "priority": {"type": "string", "enum": ["Urgent", "High", "Normal", "Low"]},
                        "zendesk_priority": {"type": "string", "enum": ["urgent", "high", "normal", "low"]},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "required_actions": {"type": "array", "items": {"type": "string"}},
                        "customer_stage": {"type": "string", "enum": ["placed_order", "prospect", "unknown"]},
                        "draft_response": {"type": "string"},
                        "internal_note": {"type": "string"},
                        "escalate_to_whatsapp": {"type": "boolean"},
                        "place_order_on_hold": {"type": "boolean"},
                    },
                    "required": [
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
                    "additionalProperties": False,
                },
            }
        },
    }

    req = request.Request(
        OPENAI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    with request.urlopen(req, timeout=45) as response:
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    text = data.get("output_text", "").strip()
    if not text:
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    text += content.get("text", "")
    if not text:
        raise ValueError("OpenAI returned no structured output.")
    return json.loads(text)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type="text/html; charset=utf-8"):
        if not path.exists():
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path in {"/", "/index.html"}:
            self._send_file(INDEX_FILE)
            return
        if self.path in {"/portal", "/portal.html"}:
            self._send_file(PORTAL_FILE)
            return
        if self.path == "/health":
            self._send_json({"status": "ok", "service": "capgown-test-portal"})
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/api/analyze":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or "{}")
        ticket = payload.get("ticket") or payload

        normalized = {
            "customerName": ticket.get("customerName") or ticket.get("requesterName") or "Customer",
            "orderNumber": ticket.get("orderNumber") or "N/A",
            "subject": ticket.get("subject") or "",
            "body": ticket.get("body") or ticket.get("description") or "",
            "tags": ticket.get("tags") or [],
        }

        try:
            result = call_openai(normalized) or build_mock_result(normalized)
            mode = "openai" if os.environ.get("OPENAI_API_KEY") else "mock"
            result["auto_reply"] = should_auto_reply(result)
            self._send_json({"ok": True, "mode": mode, "result": result})
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=500)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"CAPGOWN test portal running at http://127.0.0.1:{port}/portal.html")
    print("Mode:", "openai" if os.environ.get("OPENAI_API_KEY") else "mock")
    server.serve_forever()
