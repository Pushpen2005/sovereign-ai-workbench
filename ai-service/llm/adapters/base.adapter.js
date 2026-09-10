/**
 * Base Model Provider Adapter
 *
 * Defines the standard contract for local inference runtime adapters (Ollama, MLX, etc.).
 */

export class BaseAdapter {
    constructor(name) {
        if (new.target === BaseAdapter) {
            throw new TypeError("Cannot construct BaseAdapter instances directly");
        }
        this.name = name;
    }

    /**
     * Executes generation request.
     *
     * @param {string} prompt
     * @param {string} model
     * @param {object} options
     * @returns {Promise<string>}
     */
    async generate(prompt, model, options = {}) {
        throw new Error("Method 'generate()' must be implemented");
    }

    /**
     * Checks whether this provider is healthy and reachable.
     *
     * @returns {Promise<boolean>}
     */
    async checkHealth() {
        throw new Error("Method 'checkHealth()' must be implemented");
    }

    /**
     * Lists available models for this provider.
     *
     * @returns {Promise<Array<{ name: string, size?: number }>>}
     */
    async listModels() {
        throw new Error("Method 'listModels()' must be implemented");
    }

    /**
     * Pre-warms the given model into memory.
     *
     * @param {string} model
     * @returns {Promise<{ success: boolean, durationMs: number }>}
     */
    async warmModel(model) {
        throw new Error("Method 'warmModel()' must be implemented");
    }
}
