// services/chat/SessionManager.js
import { v4 as uuidv4 } from "uuid";

/**
 * @constant {number} SESSION_TIMEOUT - Duration in milliseconds for which a session remains active without activity.
 */
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Manages chat sessions, handling creation, retrieval, expiration, and deletion.
 */
class SessionManager {
  /**
   * Constructs a new SessionManager instance.
   *
   * @param {function(string): void} cleanupCallback - A callback function invoked when a session expires.
   * It receives the session ID as an argument.
   */
  constructor(cleanupCallback) {
    /**
     * @type {Map<string, object>} sessions - Stores session data, keyed by session ID.
     * Each session object contains:
     * - threadId: (string|null) The ID of the associated chat thread.
     * - lastActive: (number) Timestamp of the last activity.
     * - timeoutId: (number|null) ID of the timeout for session expiration.
     * - status: ('active'|'pending_deletion') The current status of the session.
     */
    this.sessions = new Map();

    /**
     * @type {function(string): void} cleanupCallback - The callback function to execute when a session times out.
     */
    this.cleanupCallback = cleanupCallback;
  }

  /**
   * Creates a new chat session and returns its ID.
   *
   * @returns {string} The newly created session ID.
   */
  createSession() {
    const sessionId = uuidv4();
    const session = {
      threadId: null,
      lastActive: Date.now(),
      timeoutId: null,
      status: 'active' // Initial status is active
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Retrieves a session object by its ID.
   *
   * @param {string} sessionId - The ID of the session to retrieve.
   * @returns {object|undefined} The session object, or undefined if not found.
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Checks if a session with the given ID exists and is active.
   *
   * @param {string} sessionId - The ID of the session to check.
   * @returns {boolean} True if the session exists and is active, false otherwise.
   */
  hasSession(sessionId) {
    return this.sessions.has(sessionId) && this.sessions.get(sessionId).status === 'active';
  }

  /**
   * Refreshes the last active timestamp of a session, preventing its expiration.
   *
   * @param {string} sessionId - The ID of the session to refresh.
   * @returns {object|null} The refreshed session object, or null if the session does not exist or is not active.
   */
  refreshSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session || session.status !== 'active') return null;

    session.lastActive = Date.now();

    // Clear existing timeout if any
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }

    // Schedule new cleanup
    this.scheduleCleanup(sessionId);

    return session;
  }

  /**
   * Schedules a cleanup task for a session, setting a timeout for its expiration.
   *
   * @param {string} sessionId - The ID of the session to schedule cleanup for.
   */
  scheduleCleanup(sessionId) {
    const session = this.getSession(sessionId);
    if (!session || session.status !== 'active') return;

    // Clear existing timeout if any
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }

    // Set new timeout
    session.timeoutId = setTimeout(
      () => this.cleanupCallback(sessionId),
      SESSION_TIMEOUT
    );
  }

  /**
   * Marks a session for deletion, changing its status to 'pending_deletion'.
   *
   * @param {string} sessionId - The ID of the session to mark for deletion.
   * @returns {boolean} True if the session was successfully marked, false otherwise.
   */
  markSessionForDeletion(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return false;

    session.status = 'pending_deletion';
    return true;
  }

  /**
   * Deletes a session and clears its timeout.
   *
   * @param {string} sessionId - The ID of the session to delete.
   */
  deleteSession(sessionId) {
    const session = this.getSession(sessionId);
    if (session && session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    this.sessions.delete(sessionId);
  }

  /**
   * Retrieves a list of expired session IDs, including those marked for deletion or timed out.
   *
   * @returns {string[]} An array of session IDs that have expired.
   */
  getExpiredSessions() {
    const now = Date.now();
    const expiredSessions = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.status === 'pending_deletion' ||
          (now - session.lastActive > SESSION_TIMEOUT && session.status === 'active')) {
        expiredSessions.push(sessionId);
      }
    }

    return expiredSessions;
  }
}

export default SessionManager;