import { generateClientToken } from 'agora-agents';
import agoraToken from 'agora-token';
import { VOICE_UIDS, type VoiceClientRole, type VoiceTokenGrant } from '@ave/shared';
import type { RtcSettings } from './settings.js';

// agora-token is CommonJS: named imports fail at runtime under Node ESM, so destructure the default export.
const { RtmTokenBuilder, RtcTokenBuilder, RtcRole } = agoraToken;

const NAME_PREFIX = 'ave';
const MS_PER_SECOND = 1000;

/** The Agora channel of one call. Session ids are short hex, well inside Agora's 64-byte limit. */
export function channelFor(sessionId: string): string {
  return `${NAME_PREFIX}-${sessionId}`;
}

/** Agent names must be unique per start (Agora returns 409 on reuse). */
export function agentNameFor(sessionId: string, startNumber: number): string {
  return `${NAME_PREFIX}-${sessionId}-${startNumber}`;
}

/** RTM user id: unique per call and role, so two calls never share a signalling login. */
export function rtmUserIdFor(sessionId: string, role: VoiceClientRole): string {
  return `${NAME_PREFIX}-${role}-${sessionId}`;
}

export function uidFor(role: VoiceClientRole): number {
  return role === 'advisor' ? VOICE_UIDS.advisor : VOICE_UIDS.buyer;
}

/**
 * One RTC + RTM token for one participant (`buildTokenWithRtm` under the hood). Expiry is seconds
 * from now for both the token and its privileges, never 0.
 */
export function issueClientToken(rtc: RtcSettings, sessionId: string, role: VoiceClientRole, now: number): VoiceTokenGrant {
  const channel = channelFor(sessionId);
  const uid = uidFor(role);
  const token = generateClientToken({
    appId: rtc.appId,
    appCertificate: rtc.appCertificate,
    channelName: channel,
    uid,
    tokenExpire: rtc.tokenTtlSec,
    privilegeExpire: rtc.tokenTtlSec,
  });
  const rtmUserId = rtmUserIdFor(sessionId, role);
  const rtmToken = RtmTokenBuilder.buildToken(rtc.appId, rtc.appCertificate, rtmUserId, rtc.tokenTtlSec);
  return {
    available: true,
    appId: rtc.appId,
    channel,
    uid,
    token,
    rtmUserId,
    rtmToken,
    expiresAt: now + rtc.tokenTtlSec * MS_PER_SECOND,
    agentUid: VOICE_UIDS.agent,
    buyerUid: VOICE_UIDS.buyer,
    advisorUid: VOICE_UIDS.advisor,
    advisorName: rtc.advisorName,
    ...(role === 'advisor' ? { sttBotUid: VOICE_UIDS.stt } : {}),
  };
}

/**
 * RTC-only token for a server-side bot that joins the call's channel (the Real-Time STT bot). Required by
 * Agora whenever the app certificate is on; the bot publishes caption stream messages, so it is a publisher.
 */
export function issueBotRtcToken(rtc: RtcSettings, sessionId: string, uid: number): string {
  return RtcTokenBuilder.buildTokenWithUid(rtc.appId, rtc.appCertificate, channelFor(sessionId), uid, RtcRole.PUBLISHER, rtc.tokenTtlSec, rtc.tokenTtlSec);
}
