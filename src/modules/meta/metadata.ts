import { ACCOUNT_FIELDS, AD_FIELDS, ADSET_FIELDS, CAMPAIGN_FIELDS } from "./constants";
import type { MetaGraphClient } from "./client";
import { joinFields } from "./fields";
import {
  upsertAccount,
  upsertAds,
  upsertAdsets,
  upsertCampaigns,
  upsertCreatives,
} from "./repository";
import type {
  MetaAccountRow,
  MetaAdNode,
  MetaAdsetNode,
  MetaCampaignNode,
  MetaCreativeNode,
} from "./types";

export async function fetchAndStoreAccount(
  client: MetaGraphClient,
  adAccountId: string
): Promise<MetaAccountRow> {
  const response = await client.get<never>(adAccountId, {
    fields: joinFields(ACCOUNT_FIELDS),
  });
  const body = response as unknown as {
    name?: string;
    currency?: string;
    timezone_name?: string;
    timezone_offset_hours_utc?: number;
    account_status?: number | string;
    business_name?: string;
    business?: { name?: string };
  };

  const account: MetaAccountRow = {
    ad_account_id: adAccountId,
    account_name: body.name ?? null,
    currency: body.currency ?? null,
    timezone_name: body.timezone_name ?? null,
    timezone_offset_hours:
      body.timezone_offset_hours_utc == null ? null : Number(body.timezone_offset_hours_utc),
    account_status: body.account_status == null ? null : String(body.account_status),
    business_name: body.business_name ?? body.business?.name ?? null,
  };
  await upsertAccount(account);
  return account;
}

export async function syncMetadata(
  client: MetaGraphClient,
  adAccountId: string
): Promise<{ campaigns: number; adsets: number; ads: number; creatives: number }> {
  const now = new Date().toISOString();
  const campaigns = await client.getPaged<MetaCampaignNode>(`${adAccountId}/campaigns`, {
    fields: joinFields(CAMPAIGN_FIELDS),
    limit: String(client.env.META_PAGE_LIMIT),
  });
  await upsertCampaigns(
    campaigns
      .filter((row) => row.id)
      .map((row) => ({
        campaign_id: String(row.id),
        ad_account_id: adAccountId,
        name: row.name ?? null,
        objective: row.objective ?? null,
        status: row.status ?? null,
        effective_status: row.effective_status ?? null,
        buying_type: row.buying_type ?? null,
        special_ad_categories: row.special_ad_categories ?? null,
        start_time: row.start_time ?? null,
        stop_time: row.stop_time ?? null,
        created_time: row.created_time ?? null,
        updated_time: row.updated_time ?? null,
        daily_budget: row.daily_budget == null ? null : Number(row.daily_budget),
        lifetime_budget: row.lifetime_budget == null ? null : Number(row.lifetime_budget),
        last_synced_at: now,
        updated_at: now,
      }))
  );

  const adsets = await client.getPaged<MetaAdsetNode>(`${adAccountId}/adsets`, {
    fields: joinFields(ADSET_FIELDS),
    limit: String(client.env.META_PAGE_LIMIT),
  });
  await upsertAdsets(
    adsets
      .filter((row) => row.id && row.campaign_id)
      .map((row) => ({
        adset_id: String(row.id),
        campaign_id: String(row.campaign_id),
        ad_account_id: adAccountId,
        name: row.name ?? null,
        status: row.status ?? null,
        effective_status: row.effective_status ?? null,
        optimization_goal: row.optimization_goal ?? null,
        billing_event: row.billing_event ?? null,
        bid_strategy: row.bid_strategy ?? null,
        daily_budget: row.daily_budget == null ? null : Number(row.daily_budget),
        lifetime_budget: row.lifetime_budget == null ? null : Number(row.lifetime_budget),
        start_time: row.start_time ?? null,
        end_time: row.end_time ?? null,
        last_synced_at: now,
        updated_at: now,
      }))
  );

  const ads = await client.getPaged<MetaAdNode>(`${adAccountId}/ads`, {
    fields: joinFields(AD_FIELDS),
    limit: String(client.env.META_PAGE_LIMIT),
  });

  const creatives = new Map<string, MetaCreativeNode>();
  for (const ad of ads) {
    if (ad.creative?.id) creatives.set(ad.creative.id, ad.creative);
  }
  await upsertCreatives(
    [...creatives.values()].map((row) => ({
      creative_id: String(row.id),
      ad_account_id: adAccountId,
      name: row.name ?? null,
      title: row.title ?? null,
      body: row.body ?? null,
      call_to_action_type: row.call_to_action_type ?? null,
      thumbnail_url: row.thumbnail_url ?? null,
      image_url: row.image_url ?? null,
      video_id: row.video_id ?? null,
      instagram_actor_id: row.instagram_actor_id ?? null,
      page_id: null,
      destination_url: null,
      url_tags: row.url_tags ?? null,
      last_synced_at: now,
      updated_at: now,
    }))
  );

  await upsertAds(
    ads
      .filter((row) => row.id && row.adset_id && row.campaign_id)
      .map((row) => ({
        ad_id: String(row.id),
        adset_id: String(row.adset_id),
        campaign_id: String(row.campaign_id),
        ad_account_id: adAccountId,
        name: row.name ?? null,
        status: row.status ?? null,
        effective_status: row.effective_status ?? null,
        creative_id: row.creative?.id ?? null,
        created_time: row.created_time ?? null,
        updated_time: row.updated_time ?? null,
        last_synced_at: now,
        updated_at: now,
      }))
  );

  return {
    campaigns: campaigns.length,
    adsets: adsets.length,
    ads: ads.length,
    creatives: creatives.size,
  };
}
