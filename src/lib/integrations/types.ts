export type Provider = "shiprocket" | "shopify" | "meta-ads" | "google-ads";

export interface IntegrationEvent {
  id: string;
  provider: Provider;
  event_type: string | null;
  request_hash: string;
  payload: Record<string, unknown>;
  request_headers: Record<string, string> | null;
  status: EventStatus;
  attempt_count: number;
  last_error: string | null;
  received_at: string;
  processing_started_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EventStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "dead_letter";

export interface QueueMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  visible_at: string;
  execution_count: number;
  message: { event_id: string };
}

export interface PabblyDelivery {
  id: string;
  event_id: string;
  provider: Provider;
  status: "pending" | "sent" | "failed";
  attempt_count: number;
  response_code: number | null;
  response_body: Record<string, unknown> | null;
  last_error: string | null;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}
