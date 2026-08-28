export { getMetaEnv, isMetaSyncEnabled, resetMetaEnvCache, getMetaAccessToken, getMetaAdAccountId } from "./env";
export { authorizeDashboard, authorizeInternalSync, dashboardAuthConfigured, safeCompare } from "./internal-auth";
export { MetaGraphClient, buildAuthorizationHeader } from "./client";
export { runMetaSync, resolveSyncRange, getSyncStatus } from "./sync";
export { runMetaBackfill, planBackfillChunks } from "./backfill";
export {
  startMetaScheduler,
  stopMetaScheduler,
  shouldStartLocalMetaScheduler,
  runScheduledTodaySync,
} from "./scheduler";
export {
  loadMetaOverview,
  loadMetaKpis,
  loadMetaDaily,
  loadMetaCampaigns,
  loadMetaAdsets,
  loadMetaAds,
  loadMetaFunnel,
  loadMetaVideo,
  loadMetaActions,
  loadMetaPlacements,
  loadMetaDevices,
  loadMetaDemographics,
  loadMetaGeo,
  loadMetaSyncHealth,
  clampPageSize,
  paginate,
} from "./analytics";
export {
  MetaAuthError,
  MetaError,
  MetaSyncConflictError,
  MetaSyncDisabledError,
  MetaSyncLockError,
  sanitizeMetaError,
} from "./errors";
export { metaErrorResponse, publicSyncResult, resolveDashboardDateRange } from "./http";
