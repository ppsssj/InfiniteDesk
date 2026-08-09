export function nativeWindowHandleToString(handle: Buffer): string {
  if (handle.length >= 8) {
    return `0x${handle.readBigUInt64LE(0).toString(16).toUpperCase()}`;
  }

  return `0x${handle.readUInt32LE(0).toString(16).toUpperCase()}`;
}
