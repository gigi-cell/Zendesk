export const CATEGORY_DEFINITIONS = [
  {
    name: "Exchange",
    autoReply: false,
    notes: "Accepted for incorrect size, defect, or fulfillment error. No international exchanges.",
  },
  {
    name: "Shipping",
    autoReply: false,
    notes: "Tracking lookups, carrier claims, lost packages, and urgent requests need human handling.",
  },
  {
    name: "Sizing",
    autoReply: true,
    notes: "Sizing guidance should follow shoulder-to-floor height and reference the sizing guide.",
  },
  {
    name: "Order Update",
    autoReply: false,
    notes: "Address, email, and sizing changes require manual system updates before confirmation.",
  },
  {
    name: "Return",
    autoReply: false,
    notes: "Quality issues may receive a free return label. Change-of-mind returns do not receive a store-paid label.",
  },
  {
    name: "Refund/Cancellation",
    autoReply: false,
    notes: "Refunds and cancellations require human review and may depend on ship status and ceremony timing.",
  },
  {
    name: "Out of Stock",
    autoReply: false,
    notes: "Offer nearby sizes, generic black regalia, partial refund, hold until restock, pre-order, or cancellation as appropriate.",
  },
  {
    name: "Rental",
    autoReply: true,
    notes: "General rental-process questions are safe; return verification and late-fee workflows are not.",
  },
  {
    name: "Rental Keeper",
    autoReply: false,
    notes: "Customer may be able to pay to keep some or all rental regalia.",
  },
  {
    name: "Invoice/Receipt",
    autoReply: false,
    notes: "Invoice replies usually require a real attachment or a manual send from Shopify.",
  },
  {
    name: "Gender Neutral Inquiry",
    autoReply: true,
    notes: "Regalia is gender-neutral.",
  },
  {
    name: "Tax Exemption",
    autoReply: false,
    notes: "Tax-exempt handling should stay manual until the full subdoc process is reviewed.",
  },
  {
    name: "Missing Garment Bag",
    autoReply: false,
    notes: "Apologize and follow up with fulfillment to ship separately.",
  },
  {
    name: "No Local Office",
    autoReply: true,
    notes: "CAPGOWN is online only and has no physical office; direct customers to the website or phone support.",
  },
  {
    name: "Pre-Order",
    autoReply: false,
    notes: "Pre-orders usually require collecting size/tam/tassel details and sending a custom link.",
  },
  {
    name: "Fraud Alert",
    autoReply: false,
    notes: "Customer identity must be verified before any action.",
  },
  {
    name: "Hood/Piping Verification",
    autoReply: false,
    notes: "Premium Black hood or piping issues should place the order on hold and reach out.",
  },
  {
    name: "International Delivery",
    autoReply: false,
    notes: "Delivery failures require carrier follow-up and phone number verification.",
  },
];

export const CATEGORY_NAMES = CATEGORY_DEFINITIONS.map((category) => category.name);

export const AUTO_REPLY_CATEGORIES = new Set(
  CATEGORY_DEFINITIONS.filter((category) => category.autoReply).map((category) => category.name),
);

export const CAPGOWN_POLICY_SUMMARY = [
  "Exchanges are accepted for incorrect size, defects, or fulfillment errors, but international exchanges are not offered.",
  "Returns are accepted. If the customer simply changed their mind, they cover return shipping.",
  "Quality-related returns may receive a free return label. Change-of-mind returns should not be promised a free return label.",
  "Regalia is gender-neutral and fits all builds.",
  "CAPGOWN has no physical office; service is online only at capgown.com.",
  "Pre-orders can be offered when inventory is unavailable for the current season.",
  "Pre-orders usually require size, tam size, tassel details, and a manually generated purchase link.",
  "Rental customers choose a ceremony date, typically receive regalia 2-3 weeks before the ceremony, and return regalia about 7 days after the event.",
  "Rental Keeper requests may allow the customer to keep individual pieces or the full rental for an additional charge, but only if there is an associated rental order.",
  "Customers who already placed an order can receive diploma frame code EFRAME10.",
  "Prospects considering an order can receive code HENRIETTA10.",
  "Urgent shipping issues should be flagged for WhatsApp escalation.",
  "Tracking lookups, carrier-claim filing, address updates, invoice attachments, refunds, and order edits are manual actions. Do not imply they are already completed unless the context confirms completion.",
  "Fraud alerts require identity verification before any action.",
  "Fraud-alert orders should remain on hold until the customer verifies order number, purchase date, last four card digits, and billing address.",
  "Premium Black hood or piping concerns require the order to be placed on hold before replying.",
  "Out-of-stock resolutions can include nearby size substitutions, generic black regalia, holding the order until restock, partial refund, pre-order, or full cancellation.",
  "If a garment bag is missing, apologize and coordinate a separate shipment with fulfillment.",
  "If international delivery fails, the customer needs to update their phone number and contact the carrier.",
  "Sizing guidance should use the sizing guide and shoulder-to-floor height. CAPGOWN does not currently offer tailoring or XXS sizing.",
];
