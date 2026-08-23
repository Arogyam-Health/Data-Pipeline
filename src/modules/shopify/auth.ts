import { getShopifyEnv, type ShopifyEnv } from "./env";
import { ShopifyConfigError } from "./errors";

/**
 * Returns the existing authorized Shopify access token from private server env.
 * Never logs, persists, or exposes the value.
 */
export function getShopifyAccessToken(env?: ShopifyEnv): string {
  const token = (env ?? getShopifyEnv()).SHOPIFY_ACCESS_TOKEN;
  if (!token) {
    throw new ShopifyConfigError(
      "SHOPIFY_ACCESS_TOKEN is missing. Copy the existing authorized token into the private server environment."
    );
  }
  return token;
}
