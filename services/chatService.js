// services/chatService.js
import ChatService from './chat/index.js';

/**
 * Sets up Socket.IO event handlers for chat functionality.
 *
 * This function acts as an adapter to maintain backward compatibility with
 * existing code that expects a direct `setupSocketHandlers` function. It
 * initializes a `ChatService` instance and delegates the socket setup to it.
 *
 * @param {object} socket - The Socket.IO socket object for the client connection.
 * @param {object} openai - An instance of the OpenAI API client.
 * @param {object} io - An instance of the Socket.IO server.
 */
export function setupSocketHandlers(socket, openai, io) {
  // Create a new instance of the ChatService.
  const chatService = new ChatService(openai, io);

  // Delegate the socket setup to the ChatService instance.
  chatService.setupSocketHandlers(socket);
}