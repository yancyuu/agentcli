/**
 * @deprecated Use @shared/types/hermitBridge for new code.
 *
 * Compatibility exports for older Hermit code that still imports the bridge
 * protocol types through the historical ccConnect module name.
 */

export type {
  HermitBridgeApiResponse as CcApiResponse,
  HermitBridgeStatus as CcStatus,
  HermitBridgeAgentType as CcAgentType,
  HermitBridgeProjectListItem as CcProjectListItem,
  HermitBridgeProjectPlatform as CcProjectPlatform,
  HermitBridgeProjectHeartbeat as CcProjectHeartbeat,
  HermitBridgeProjectSettings as CcProjectSettings,
  HermitBridgeProjectDetail as CcProjectDetail,
  HermitBridgeProjectSettingsUpdate as CcProjectSettingsUpdate,
  HermitBridgeAddPlatformRequest as CcAddPlatformRequest,
  HermitBridgeSessionMessage as CcSessionMessage,
  HermitBridgeSessionListItem as CcSessionListItem,
  HermitBridgeSessionDetail as CcSessionDetail,
  HermitBridgeHeartbeatStatus as CcHeartbeatStatus,
  HermitBridgeProviderModelEntry as CcProviderModelEntry,
  HermitBridgeGlobalProvider as CcGlobalProvider,
  HermitBridgeProviderPresetAgentConfig as CcProviderPresetAgentConfig,
  HermitBridgeProviderPreset as CcProviderPreset,
  HermitBridgeProviderPresetsResponse as CcProviderPresetsResponse,
  HermitBridgeModelEntry as CcModelEntry,
  HermitBridgeCronJob as CcCronJob,
  HermitBridgeCreateCronJobRequest as CcCreateCronJobRequest,
  HermitBridgeRegisterMessage as CcBridgeRegisterMessage,
  HermitBridgeUserMessage as CcBridgeUserMessage,
  HermitBridgeTokenUsage as CcBridgeTokenUsage,
  HermitBridgeReplyMessage as CcBridgeReplyMessage,
  HermitBridgeReplyStreamMessage as CcBridgeReplyStreamMessage,
  HermitBridgeCardMessage as CcBridgeCardMessage,
  HermitBridgeButtonsMessage as CcBridgeButtonsMessage,
  HermitBridgeTypingMessage as CcBridgeTypingMessage,
  HermitBridgePingMessage as CcBridgePingMessage,
  HermitBridgePongMessage as CcBridgePongMessage,
  HermitBridgeUsageMessage as CcBridgeUsageMessage,
  HermitBridgeCardActionMessage as CcBridgeCardActionMessage,
  HermitBridgeIncomingMessage as CcBridgeIncomingMessage,
  HermitBridgeOutgoingMessage as CcBridgeOutgoingMessage,
  HermitBridgeProjectMapping as CcProjectMapping,
  HermitBridgeConnectionConfig as CcConnectConfig,
} from './hermitBridge';

export { HERMIT_BRIDGE_DEFAULTS as CC_CONNECT_DEFAULTS } from './hermitBridge';
