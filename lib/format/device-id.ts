// The portal shows a linked device by a short prefix of its ID, never the whole
// thing. A device ID is what AvServ uses to recognise a device on
// re-registration (beta blocker B7), so the full value is worth keeping off
// screens and screenshots; a prefix is enough to tell a user's devices apart.
export const DEVICE_ID_PREFIX_LENGTH = 8;

export function shortDeviceId(deviceId: string): string {
  if (deviceId.length <= DEVICE_ID_PREFIX_LENGTH) return deviceId;
  return `${deviceId.slice(0, DEVICE_ID_PREFIX_LENGTH)}…`;
}
