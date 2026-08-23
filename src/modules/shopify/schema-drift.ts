import {
  CUSTOMER_KNOWN_FIELDS,
  DISCOUNT_APPLICATION_KNOWN_FIELDS,
  FULFILLMENT_KNOWN_FIELDS,
  LINE_ITEM_KNOWN_FIELDS,
  ORDER_KNOWN_FIELDS,
  REFUND_KNOWN_FIELDS,
  SHIPPING_LINE_KNOWN_FIELDS,
  TRANSACTION_KNOWN_FIELDS,
} from "./constants";
import { connectionNodes } from "./graphql";
import type { SchemaDriftObservation, ShopifyOrderNode } from "./types";

const ORDER_KNOWN = new Set<string>(ORDER_KNOWN_FIELDS);
const LINE_ITEM_KNOWN = new Set<string>(LINE_ITEM_KNOWN_FIELDS);
const CUSTOMER_KNOWN = new Set<string>(CUSTOMER_KNOWN_FIELDS);
const FULFILLMENT_KNOWN = new Set<string>(FULFILLMENT_KNOWN_FIELDS);
const REFUND_KNOWN = new Set<string>(REFUND_KNOWN_FIELDS);
const TRANSACTION_KNOWN = new Set<string>(TRANSACTION_KNOWN_FIELDS);
const SHIPPING_KNOWN = new Set<string>(SHIPPING_LINE_KNOWN_FIELDS);
const DISCOUNT_KNOWN = new Set<string>(DISCOUNT_APPLICATION_KNOWN_FIELDS);

export function observedType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "object") return "object";
  return t;
}

function walkUnknown(
  obj: Record<string, unknown> | null | undefined,
  known: Set<string>,
  entityType: string,
  prefix: string,
  out: SchemaDriftObservation[]
): void {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__typename") continue;
    if (!known.has(key)) {
      out.push({
        entity_type: entityType,
        field_path: prefix ? `${prefix}.${key}` : key,
        observed_type: observedType(value),
      });
    }
  }
}

export function detectSchemaDrift(order: ShopifyOrderNode): SchemaDriftObservation[] {
  const observations: SchemaDriftObservation[] = [];
  walkUnknown(order as unknown as Record<string, unknown>, ORDER_KNOWN, "orders", "orders", observations);

  if (order.customer) {
    walkUnknown(
      order.customer as unknown as Record<string, unknown>,
      CUSTOMER_KNOWN,
      "customer",
      "customer",
      observations
    );
  }

  for (const item of connectionNodes(order.lineItems)) {
    walkUnknown(
      item as unknown as Record<string, unknown>,
      LINE_ITEM_KNOWN,
      "line_items",
      "line_items",
      observations
    );
  }

  for (const fulfillment of connectionNodes(order.fulfillments)) {
    walkUnknown(
      fulfillment as unknown as Record<string, unknown>,
      FULFILLMENT_KNOWN,
      "fulfillments",
      "fulfillments",
      observations
    );
  }

  for (const refund of connectionNodes(order.refunds)) {
    walkUnknown(
      refund as unknown as Record<string, unknown>,
      REFUND_KNOWN,
      "refunds",
      "refunds",
      observations
    );
  }

  for (const transaction of connectionNodes(order.transactions)) {
    walkUnknown(
      transaction as unknown as Record<string, unknown>,
      TRANSACTION_KNOWN,
      "transactions",
      "transactions",
      observations
    );
  }

  for (const shipping of connectionNodes(order.shippingLines)) {
    walkUnknown(
      shipping as unknown as Record<string, unknown>,
      SHIPPING_KNOWN,
      "shipping_lines",
      "shipping_lines",
      observations
    );
  }

  for (const discount of connectionNodes(order.discountApplications)) {
    walkUnknown(
      discount as unknown as Record<string, unknown>,
      DISCOUNT_KNOWN,
      "discounts",
      "discounts",
      observations
    );
  }

  return observations;
}

export function mergeDriftObservations(
  observations: SchemaDriftObservation[]
): SchemaDriftObservation[] {
  const map = new Map<string, SchemaDriftObservation>();
  for (const obs of observations) {
    const key = `${obs.entity_type}|${obs.field_path}|${obs.observed_type}`;
    if (!map.has(key)) {
      map.set(key, obs);
    }
  }
  return [...map.values()];
}
