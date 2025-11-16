/**
 * Utility functions for ID validation
 * Supports both MongoDB ObjectId (legacy) and UUID (PostgreSQL)
 */

/**
 * Validates if a value is a valid UUID (v4)
 * @param id - The ID to validate
 * @returns true if valid UUID, false otherwise
 */
export function isValidUuid(id: any): id is string {
  if (!id || typeof id !== 'string') return false;
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validates if a value is a valid MongoDB ObjectId (legacy support)
 * @param id - The ID to validate
 * @returns true if valid ObjectId, false otherwise
 */
export function isValidObjectId(id: any): id is string {
  if (!id || typeof id !== 'string') return false;
  // MongoDB ObjectID is 24 hex characters
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Validates if a value is a valid ID (UUID or ObjectId)
 * Use this for backward compatibility during migration
 * @param id - The ID to validate
 * @returns true if valid ID, false otherwise
 */
export function isValidId(id: any): id is string {
  return isValidUuid(id) || isValidObjectId(id);
}
