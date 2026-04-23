/**
 * Register a global BigInt→string serializer. Prisma returns BigInt for
 * `bigint` primary keys, and JSON.stringify throws on BigInt by default.
 * Import this module once at process start.
 */

// Polyfill toJSON on BigInt so JSON.stringify emits strings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export function toPlainId(id: bigint | number | string): string {
  return typeof id === 'bigint' ? id.toString() : String(id);
}
