# CAPGOWN Doc Audit

This audit was built from the master CAPGOWN customer-service Google Doc plus the linked subdocs that were publicly readable from it.

## Reviewed docs

- Exchange
- Shipping
- Sizing
- Order information updates
- Returns
- Refunds / cancellations
- Out of stock / inventory
- Rental process
- Rental keeper
- Invoice / receipt
- Gender-neutral inquiry
- No local office
- Pre-orders
- Fraud alert verification
- Hood / piping verification
- International delivery assistance

## Subdocs that were not publicly readable

- Tax exemption
- Garment bag / carrying case

Those two categories are still implemented from the master doc summary rather than the locked subdoc templates.

## Key findings

- `Invoice/Receipt` should not auto-send because the template expects a real invoice attachment.
- `Pre-Order` should not auto-send because the template requires collecting size/tam/tassel details and sending a generated purchase link.
- `Exchange` should not auto-send because the template promises operational actions like a replacement shipment within 48 hours and a prepaid return label.
- `Order Update` should not auto-send because the template assumes manual updates in Shopify / ShipHero before the reply is sent.
- `Return` logic must distinguish quality issues from change-of-mind returns. Only the quality path gets a store-paid label.
- `Shipping` logic needs manual review for tracking lookups, label-created delays, lost-package claims, alternate-address reships, and WhatsApp escalation.
- `Fraud Alert` must keep the order on hold until identity details are verified.
- `Hood/Piping Verification` must place the order on hold and request missing selections.
- `International Delivery` must ask for an updated phone number and direct the customer to contact the carrier.
- `Rental` can still answer general process questions safely, but verification, return-status, and late-fee workflows need human review.

## Recommendations implemented in the agent

- More conservative auto-reply categories
- Stronger prompt rules around not pretending manual actions are already complete
- Explicit required-action tracking for attachments, verification, claims, and order updates
- Richer policy summary pulled from the linked CAPGOWN templates
