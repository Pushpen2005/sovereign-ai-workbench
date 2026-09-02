import crypto from "crypto";
import { query } from "../config/db.js";

/**
 * Chat Repository
 * Handles all direct SQL queries for conversations and messages in PostgreSQL.
 */

/**
 * Create a new conversation record.
 * @param {object} params
 * @param {string} [params.id]
 * @param {string} params.organizationId
 * @param {string} [params.title]
 * @returns {Promise<object>}
 */
export async function createConversation({
  id = crypto.randomUUID(),
  organizationId,
  title = "New Chat",
}) {
  const sql = `
    INSERT INTO conversations (
      id,
      organization_id,
      title,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, NOW(), NOW())
    RETURNING
      id,
      organization_id AS "organizationId",
      title,
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const res = await query(sql, [id, organizationId, title]);
  return res.rows[0];
}

/**
 * Find a conversation by ID within an organization.
 * @param {string} id
 * @param {string} organizationId
 * @returns {Promise<object|null>}
 */
export async function findConversationById(id, organizationId) {
  const sql = `
    SELECT
      id,
      organization_id AS "organizationId",
      title,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM conversations
    WHERE id = $1 AND organization_id = $2;
  `;

  const res = await query(sql, [id, organizationId]);
  return res.rows[0] || null;
}

/**
 * Find all conversations for an organization, ordered newest first.
 * Includes message count.
 * @param {string} organizationId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @returns {Promise<Array<object>>}
 */
export async function findConversationsByOrganizationId(
  organizationId,
  { limit = 50, offset = 0 } = {}
) {
  const sql = `
    SELECT
      c.id,
      c.organization_id AS "organizationId",
      c.title,
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt",
      COUNT(m.id)::int AS "messageCount"
    FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversation_id
    WHERE c.organization_id = $1
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT $2 OFFSET $3;
  `;

  const res = await query(sql, [organizationId, limit, offset]);
  return res.rows;
}

/**
 * Update conversation updated_at timestamp and optionally title.
 * @param {string} id
 * @param {string} organizationId
 * @param {string} [title]
 * @returns {Promise<object|null>}
 */
export async function updateConversationTimestamp(id, organizationId, title = null) {
  let sql;
  let values;

  if (title && typeof title === "string") {
    sql = `
      UPDATE conversations
      SET updated_at = NOW(), title = $3
      WHERE id = $1 AND organization_id = $2
      RETURNING
        id,
        organization_id AS "organizationId",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    values = [id, organizationId, title];
  } else {
    sql = `
      UPDATE conversations
      SET updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
      RETURNING
        id,
        organization_id AS "organizationId",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    values = [id, organizationId];
  }

  const res = await query(sql, values);
  return res.rows[0] || null;
}

/**
 * Insert a message into a conversation.
 * @param {object} params
 * @param {string} [params.id]
 * @param {string} params.conversationId
 * @param {string} params.role - 'user' | 'assistant'
 * @param {string} params.content
 * @param {Array} [params.sources]
 * @param {string|null} [params.documentId]
 * @returns {Promise<object>}
 */
export async function createMessage({
  id = crypto.randomUUID(),
  conversationId,
  role,
  content,
  sources = [],
  documentId = null,
}) {
  const sql = `
    INSERT INTO messages (
      id,
      conversation_id,
      role,
      content,
      sources,
      document_id,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING
      id,
      conversation_id AS "conversationId",
      role,
      content,
      sources,
      document_id AS "documentId",
      created_at AS "createdAt";
  `;

  const values = [
    id,
    conversationId,
    role,
    content,
    JSON.stringify(sources || []),
    documentId,
  ];

  const res = await query(sql, values);
  return res.rows[0];
}

/**
 * Retrieve all messages for a given conversation in chronological order.
 * @param {string} conversationId
 * @returns {Promise<Array<object>>}
 */
export async function findMessagesByConversationId(conversationId) {
  const sql = `
    SELECT
      id,
      conversation_id AS "conversationId",
      role,
      content,
      sources,
      document_id AS "documentId",
      created_at AS "createdAt"
    FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC;
  `;

  const res = await query(sql, [conversationId]);
  return res.rows;
}

/**
 * Count total user queries for an organization.
 * @param {string} organizationId
 * @returns {Promise<number>}
 */
export async function countQueriesByOrganizationId(organizationId) {
  const sql = `
    SELECT COUNT(*)::int AS count
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.organization_id = $1 AND m.role = 'user';
  `;

  const res = await query(sql, [organizationId]);
  return res.rows[0]?.count || 0;
}

/**
 * Count total conversations for an organization.
 * @param {string} organizationId
 * @returns {Promise<number>}
 */
export async function countConversationsByOrganizationId(organizationId) {
  const sql = `
    SELECT COUNT(*)::int AS count
    FROM conversations
    WHERE organization_id = $1;
  `;

  const res = await query(sql, [organizationId]);
  return res.rows[0]?.count || 0;
}
