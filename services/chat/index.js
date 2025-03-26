// services/chat/index.js
import { v4 as uuidv4 } from "uuid";
import SessionManager from "./SessionManager.js";
import AssistantManager from "./AssistantManager.js";
import SuggestionGenerator from "./SuggestionGenerator.js";

/**
 * Manages chat sessions, handling initialization, message processing, and cleanup.
 */
class ChatService {
  /**
   * Constructs a new ChatService instance.
   *
   * @param {object} openai - An instance of the OpenAI API client.
   * @param {object} io - An instance of the Socket.IO server.
   */
  constructor(openai, io) {
    /**
     * @type {object} openai - The OpenAI API client.
     */
    this.openai = openai;

    /**
     * @type {object} io - The Socket.IO server instance.
     */
    this.io = io;

    /**
     * @type {SessionManager} sessionManager - Manages chat sessions.
     */
    this.sessionManager = new SessionManager(this.cleanupSession.bind(this));

    /**
     * @type {AssistantManager} assistantManager - Manages the OpenAI assistant.
     */
    this.assistantManager = new AssistantManager(openai);

    /**
     * @type {SuggestionGenerator} suggestionGenerator - Generates quick reply suggestions.
     */
    this.suggestionGenerator = new SuggestionGenerator(openai);

    // Set up periodic cleanup for expired sessions every 15 minutes
    setInterval(() => this.cleanupExpiredSessions(), 15 * 60 * 1000);
  }

  /**
   * Sets up Socket.IO event handlers for a new client connection.
   *
   * @param {object} socket - The Socket.IO socket object for the client.
   */
  setupSocketHandlers(socket) {
    let sessionId = null;

    // Initialize a new session
    socket.on("init_session", () => {
      sessionId = this.sessionManager.createSession();
      socket.emit("session_created", { sessionId });
    });

    // Resume an existing session or create a new one if the provided session is invalid
    socket.on("resume_session", (data) => {
      if (data.sessionId && this.sessionManager.hasSession(data.sessionId)) {
        sessionId = data.sessionId;
        const session = this.sessionManager.refreshSession(sessionId);
        if (session) {
          socket.emit("session_resumed", { sessionId });
        } else {
          sessionId = this.sessionManager.createSession();
          socket.emit("session_created", {
            sessionId,
            info: "Previous session expired",
          });
        }
      } else {
        sessionId = this.sessionManager.createSession();
        socket.emit("session_created", { sessionId });
      }
    });

    // Handle user prompts
    socket.on("send_prompt", async (data) => {
      if (!sessionId || !this.sessionManager.hasSession(sessionId)) {
        socket.emit("error", { message: "Invalid session" });
        return;
      }

      const session = this.sessionManager.refreshSession(sessionId);
      if (!session) {
        socket.emit("error", { message: "Session expired" });
        return;
      }

      try {
        await this.handlePrompt(sessionId, data.prompt, socket);
      } catch (error) {
        console.error("Error processing prompt:", error);
        socket.emit("error", {
          message: "Error processing your request",
          details:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    });

    // Handle client disconnects, schedule cleanup
    socket.on("disconnect", () => {
      if (sessionId && this.sessionManager.hasSession(sessionId)) {
        this.sessionManager.scheduleCleanup(sessionId);
      }
    });
  }

  /**
   * Handles user prompts by interacting with the OpenAI API and streaming responses.
   *
   * @async
   * @param {string} sessionId - The ID of the session.
   * @param {string} prompt - The user's prompt.
   * @param {object} socket - The Socket.IO socket object.
   */
  async handlePrompt(sessionId, prompt, socket) {
    let fullResponse = "";
    const session = this.sessionManager.getSession(sessionId);

    if (!session || session.status !== "active") {
      socket.emit("error", { message: "Session is no longer active" });
      return;
    }

    // Ensure assistant is retrieved
    try {
      await this.assistantManager.retrieveAssistant();
    } catch (error) {
      console.error("Error retrieving assistant:", error);
      socket.emit("error", { message: "Could not retrieve assistant" });
      return;
    }

    // Create thread if it doesn't exist
    if (!session.threadId) {
      try {
        const thread = await this.openai.beta.threads.create();
        session.threadId = thread.id;
      } catch (error) {
        console.error("Error creating thread:", error);
        socket.emit("error", {
          message: "Could not create conversation thread",
        });
        return;
      }
    }

    // Add user message to thread
    try {
      await this.openai.beta.threads.messages.create(session.threadId, {
        role: "user",
        content: prompt,
      });
    } catch (error) {
      console.error("Error adding message to thread:", error);
      socket.emit("error", { message: "Could not add your message" });
      return;
    }

    // Stream the response
    try {
      const stream = this.openai.beta.threads.runs.stream(session.threadId, {
        assistant_id: this.assistantManager.getAssistantId(),
      });

      stream.on("textCreated", (text) => {
        socket.emit("textCreated", text);
      });

      stream.on("textDelta", (textDelta, snapshot) => {
        fullResponse += textDelta.value;
        socket.emit("textDelta", { textDelta, snapshot });
      });

      stream.on("error", (error) => {
        console.error("Stream error:", error);
        socket.emit("error", { message: "Error during response streaming" });
      });

      stream.on("end", async () => {
        socket.emit("responseComplete");
        try {
          const suggestions = await this.suggestionGenerator.generate(
            prompt,
            fullResponse
          );
          socket.emit("suggestions", { suggestions });
        } catch (suggestionError) {
          console.error("Error generating suggestions:", suggestionError);
          // Non-critical error, don't notify user
        }

        // Schedule cleanup but don't immediately delete
        this.sessionManager.scheduleCleanup(sessionId);
      });
    } catch (error) {
      console.error("Error starting response stream:", error);
      socket.emit("error", { message: "Could not generate response" });
    }
  }

  /**
   * Cleans up a session by deleting the associated thread and session data.
   *
   * @async
   * @param {string} sessionId - The ID of the session to clean up.
   */
  async cleanupSession(sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return; // Session might already be deleted

    // Mark session as pending deletion to prevent concurrent operations
    if (!this.sessionManager.markSessionForDeletion(sessionId)) {
      return; // Session no longer exists or already marked for deletion
    }

    if (session.threadId) {
      try {
        await this.openai.beta.threads.del(session.threadId);
        this.io.emit("clear_chat", { sessionId });
        console.log(`Successfully deleted thread for session ${sessionId}`);
        this.sessionManager.deleteSession(sessionId);
      } catch (error) {
        console.error(`Error deleting thread for session ${sessionId}:`, error);

        // Keep the session marked for deletion, will be retried by cleanupExpiredSessions
        if (error.status === 404) {
          // Thread already deleted or doesn't exist, safe to remove session
          console.log(
            `Thread ${session.threadId} not found, removing session ${sessionId}`
          );
          this.sessionManager.deleteSession(sessionId);
        }
      }
    } else {
      // No thread to delete, just remove the session
      this.sessionManager.deleteSession(sessionId);
    }
  }

  /**
   * Cleans up all expired sessions.
   *
   * @async
   */
  async cleanupExpiredSessions() {
    const expiredSessions = this.sessionManager.getExpiredSessions();
    console.log(`Found ${expiredSessions.length} expired sessions to clean up`);

    for (const sessionId of expiredSessions) {
      try {
        await this.cleanupSession(sessionId);
      } catch (error) {
        console.error(`Failed to clean up session ${sessionId}:`, error);
      }
    }
  }
}

export default ChatService;
