// services/chat/AssistantManager.js

/**
 * @constant {string} ASSISTANT_ID - The ID of the OpenAI assistant.
 */

//! Replace with your assistant-ID
const ASSISTANT_ID = "asst_bwx7JzTMDI0T8Px1cgnzNh8a";

/**
 * Manages the retrieval of an OpenAI assistant.
 */
class AssistantManager {
  /**
   * Constructs a new AssistantManager instance.
   *
   * @param {object} openai - An instance of the OpenAI API client.
   */
  constructor(openai) {
    /**
     * @type {object} openai - The OpenAI API client used to retrieve the assistant.
     */
    this.openai = openai;

    /**
     * @type {object|null} assistant - The retrieved OpenAI assistant object, or null if not yet retrieved.
     */
    this.assistant = null;
  }

  /**
   * Returns the ID of the OpenAI assistant.
   *
   * @returns {string} The assistant ID.
   */
  getAssistantId() {
    return ASSISTANT_ID;
  }

  /**
   * Retrieves the OpenAI assistant. If the assistant has already been retrieved,
   * it returns the cached assistant object. Otherwise, it fetches the assistant
   * from the OpenAI API and caches it for future use.
   *
   * @async
   * @returns {Promise<object>} A promise that resolves to the retrieved assistant object.
   * @throws {Error} If there is an error retrieving the assistant from the OpenAI API.
   */
  async retrieveAssistant() {
    try {
      if (!this.assistant) {
        this.assistant = await this.openai.beta.assistants.retrieve(ASSISTANT_ID);
      }
      return this.assistant;
    } catch (error) {
      console.error("Error retrieving Assistant:", error);
      throw error;
    }
  }
}

export default AssistantManager;