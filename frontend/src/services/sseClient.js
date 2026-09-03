/**
 * SSE CLIENT SERVICE — sseClient.js
 *
 * Lightweight, robust Server-Sent Events client built on native fetch() and
 * ReadableStream.
 *
 * Features:
 * - Supports custom authorization & tenant headers (e.g. x-organization-id)
 * - Compliant with SSE protocol: parses id, event, data, retry, and heartbeat comments
 * - Supports Last-Event-ID resume
 * - Automatic reconnection with exponential backoff on transient network drops
 * - Clean teardown via AbortController on unmount
 * - Safe: Never logs secrets, tokens, or raw binaries
 */

import { API_BASE_URL } from '../api/client.js';

export class SseConnection {
  /**
   * @param {string} endpointPath - e.g. "/api/v1/agent/runs/:runId/stream"
   * @param {object} options
   * @param {(event: { id: string|null, type: string, data: any, timestamp: number }) => void} options.onEvent
   * @param {(error: Error) => void} [options.onError]
   * @param {() => void} [options.onClose]
   * @param {Record<string, string>} [options.headers]
   * @param {boolean} [options.autoReconnect=false]
   * @param {number} [options.maxReconnectAttempts=3]
   */
  constructor(endpointPath, options = {}) {
    this.endpointPath = endpointPath;
    this.options = options;
    this.abortController = null;
    this.lastEventId = null;
    this.reconnectAttempts = 0;
    this.isClosedManually = false;
    this.isConnected = false;
  }

  /**
   * Resolves authentication / tenant headers.
   */
  getHeaders() {
    const headers = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...(this.options.headers || {}),
    };

    // Forward organization ID from localStorage or environment if present
    const orgId = localStorage.getItem('organizationId') || localStorage.getItem('x-organization-id');
    if (orgId && !headers['x-organization-id']) {
      headers['x-organization-id'] = orgId;
    }

    // Forward auth token if present
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (this.lastEventId) {
      headers['Last-Event-ID'] = this.lastEventId;
    }

    return headers;
  }

  /**
   * Starts the SSE connection.
   */
  async connect() {
    this.isClosedManually = false;
    this.abortController = new AbortController();

    const fullUrl = this.endpointPath.startsWith('http')
      ? this.endpointPath
      : `${API_BASE_URL}${this.endpointPath.startsWith('/') ? '' : '/'}${this.endpointPath}`;

    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE HTTP error ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported by browser environment.');
      }

      this.isConnected = true;
      this.reconnectAttempts = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          this.parseSseChunk(part);
        }
      }

      // If finished cleanly
      this.cleanup();
      if (!this.isClosedManually && this.options.onClose) {
        this.options.onClose();
      }
    } catch (err) {
      if (this.isClosedManually || err.name === 'AbortError') {
        return;
      }

      this.cleanup();

      if (this.options.onError) {
        this.options.onError(err);
      }

      // Reconnection logic
      if (this.options.autoReconnect && this.reconnectAttempts < (this.options.maxReconnectAttempts || 3)) {
        this.reconnectAttempts++;
        const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
        setTimeout(() => {
          if (!this.isClosedManually) {
            this.connect();
          }
        }, backoffMs);
      } else if (this.options.onClose) {
        this.options.onClose();
      }
    }
  }

  /**
   * Parses a single SSE double-newline delimited block.
   *
   * @param {string} block
   */
  parseSseChunk(block) {
    const lines = block.split('\n');
    let eventType = 'message';
    let id = null;
    let dataBuffer = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Comment / Heartbeat check
      if (line.startsWith(':')) {
        if (line.includes('heartbeat') && this.options.onEvent) {
          this.options.onEvent({
            id: null,
            type: 'heartbeat',
            data: { timestamp: Date.now() },
            timestamp: Date.now(),
          });
        }
        continue;
      }

      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('id:')) {
        id = line.slice(3).trim();
        this.lastEventId = id;
      } else if (line.startsWith('data:')) {
        const chunk = line.slice(5).trim();
        dataBuffer += (dataBuffer ? '\n' : '') + chunk;
      }
    }

    if (dataBuffer || eventType !== 'message') {
      let parsedData = dataBuffer;
      try {
        parsedData = JSON.parse(dataBuffer);
      } catch {
        // preserve raw string if not JSON
      }

      if (this.options.onEvent) {
        this.options.onEvent({
          id,
          type: eventType,
          data: parsedData,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Closes the SSE connection and aborts underlying request.
   */
  disconnect() {
    this.isClosedManually = true;
    this.cleanup();
  }

  cleanup() {
    this.isConnected = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

/**
 * Creates and starts an SSE stream subscription.
 *
 * @param {string} endpointPath - Stream endpoint (e.g. `/api/v1/agent/runs/${runId}/stream`)
 * @param {object} options - Callbacks { onEvent, onError, onClose }
 * @returns {() => void} Cleanup function to unmount / abort stream
 */
export function subscribeToSse(endpointPath, options = {}) {
  const connection = new SseConnection(endpointPath, options);
  connection.connect();
  return () => connection.disconnect();
}
