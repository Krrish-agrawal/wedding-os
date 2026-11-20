import AgoraRTC, { type AgoraRTCErrorCode, type ICameraVideoTrack, type IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';

/** Agora RTC log levels: 0 debug, 1 info, 2 warning, 3 error, 4 none. */
const RTC_LOG_WARNING = 2;
const RTC_LOG_ERROR = 3;

let configured = false;

/**
 * One-time SDK setup: quiet logs (errors only in production) and audio PTS metadata, which the
 * toolkit's WORD transcript mode needs to line captions up with the advisor's voice.
 */
export function configureAgora(): typeof AgoraRTC {
  if (!configured) {
    AgoraRTC.setLogLevel(import.meta.env.DEV ? RTC_LOG_WARNING : RTC_LOG_ERROR);
    // `setParameter` exists at runtime but is missing from the default export's type declarations.
    const withParameters = AgoraRTC as unknown as { setParameter?: (key: string, value: unknown) => void };
    withParameters.setParameter?.('ENABLE_AUDIO_PTS_METADATA', true);
    configured = true;
  }
  return AgoraRTC;
}

/**
 * Microphone per Agora's audio guidance for voice agents: echo cancellation (so the advisor's voice
 * from speakers does not trigger it), noise suppression and automatic gain. Speech encoder.
 */
export function createMicrophone(): Promise<IMicrophoneAudioTrack> {
  return configureAgora().createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true, encoderConfig: 'speech_standard' });
}

/** Small camera stream: a self-view tile, and published only while a human advisor is on the call. */
export function createCamera(): Promise<ICameraVideoTrack> {
  return configureAgora().createCameraVideoTrack({ encoderConfig: '360p_7', optimizationMode: 'motion' });
}

/**
 * Device error codes. The SDK's main entry is a UMD bundle that exports only the AgoraRTC object, so
 * the `AgoraRTCErrorCode` enum is used as a type and compared by value.
 */
const PERMISSION_DENIED: `${AgoraRTCErrorCode.PERMISSION_DENIED}` = 'PERMISSION_DENIED';
const DEVICE_NOT_FOUND: `${AgoraRTCErrorCode.DEVICE_NOT_FOUND}` = 'DEVICE_NOT_FOUND';
const NOT_READABLE: `${AgoraRTCErrorCode.NOT_READABLE}` = 'NOT_READABLE';

function errorCode(err: unknown): string | null {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : null;
}

/** A calm, actionable sentence for why the microphone could not start. */
export function microphoneProblem(err: unknown): string {
  switch (errorCode(err)) {
    case PERMISSION_DENIED:
      return 'Microphone access is blocked. Allow it from the address bar to talk, or type instead.';
    case DEVICE_NOT_FOUND:
      return 'No microphone was found. Connect one to talk, or type instead.';
    case NOT_READABLE:
      return 'Another app is using your microphone. Close it to talk, or type instead.';
    default:
      return 'Your microphone could not start. You can type instead.';
  }
}

/** True when the camera failure is a permission or device problem rather than a transient one. */
export function cameraBlocked(err: unknown): boolean {
  const code = errorCode(err);
  return code === PERMISSION_DENIED || code === DEVICE_NOT_FOUND || code === NOT_READABLE;
}
