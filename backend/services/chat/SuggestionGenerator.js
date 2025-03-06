// services/chat/SuggestionGenerator.js

/**
 * ! This is a basic suggestion generator that only operates off the last response from the AI.
 * TODO You can enhance this by considering the entire conversation history and context.
 */

/**
 * Generates quick reply suggestions for a user interacting with an AI chatbot using the OpenAI API.
 */
class SuggestionGenerator {
  /**
   * Constructs a new SuggestionGenerator instance.
   *
   * @param {object} openai - An instance of the OpenAI API client.
   */
  constructor(openai) {
    /**
     * @type {object} openai - The OpenAI API client used to generate suggestions.
     */
    this.openai = openai;
  }

  /**
   * Generates three quick reply suggestions based on the provided prompt and AI response.
   *
   * @async
   * @param {string} prompt - The user's original prompt (not directly used for suggestion generation in this implementation).
   * @param {string} response - The AI chatbot's response to the user's prompt.
   * @returns {Promise<string[]>} A promise that resolves to an array of three quick reply suggestions, or an empty array if an error occurs.
   */
  async generate(prompt, response) {
    const SUGGESTIONS_PROMPT = `You are a helpful assistant designed to generate three short, relevant, and natural-sounding quick reply suggestions for a user interacting with an AI chatbot.

                **Input:** The preceding AI chatbot response.
                
                **Task:** Analyze the AI chatbot's response and generate three distinct, concise, and user-friendly quick reply suggestions. These suggestions should:
                
                * **Be short and easy to understand.** Aim for 2-10 words, or short phrases.
                * **Be relevant to the AI's response.** The suggestions should logically follow the conversation.
                * **Offer different directions for the conversation.** Avoid repetitive suggestions.
                * **Be phrased as potential user prompts.** They should sound like something a user would naturally say. Frame the quick replies as if the user is directly speaking to the chatbot.
                * **Be suitable for a casual, conversational tone.**
                * **Focus on furthering the conversation or asking for clarification.**
                
                **Output JSON Format:**
                
                {
                  "quick_replies": [
                    "Quick Reply 1",
                    "Quick Reply 2",
                    "Quick Reply 3"
                  ]
                }
                
                **Example:**
                
                **Input:** "The weather in London is currently cloudy with a chance of rain."
                
                **Output:**
                
                {
                  "quick_replies": [
                    "Tell me more",
                    "What is the temperature",
                    "Show me pictures."
                  ]
                }`;

    try {
      // Calls the OpenAI API to generate suggestions.
      const suggestionResponse = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        max_tokens: 150,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: SUGGESTIONS_PROMPT,
          },
          {
            role: "user",
            content: response,
          },
        ],
      });

      // Parses the JSON response from the OpenAI API to extract the suggestions.
      const suggestionsString = suggestionResponse.choices[0].message.content;
      const suggestionsJson = JSON.parse(suggestionsString);
      return suggestionsJson.quick_replies;
    } catch (error) {
      // Logs an error message and returns an empty array if suggestion generation fails.
      console.error("Error generating suggestions:", error);
      return [];
    }
  }
}

export default SuggestionGenerator;
