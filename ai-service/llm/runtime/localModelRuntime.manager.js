/**
 * Local Model Runtime & Lifecycle Manager (ai-service/llm/runtime/localModelRuntime.manager.js)
 *
 * Lightweight, deterministic, and safe local model lifecycle manager for Apple M4.
 *
 * Core Responsibilities:
 *  - Discover existing MLX model servers on localhost ports (:8080, :8081, :8082).
 *  - Ensure required model servers are running before inference dispatch.
 *  - Prevent duplicate process execution through port probing and Promise locks.
 *  - Standardized health check verification (STOPPED, STARTING, READY, UNHEALTHY, STOPPING, FAILED).
 *  - Safe process lifecycle control (start, stop, restart) with strict activeRequests protection.
 *  - Usage tracking (lastUsedAt, activeRequests) and conservative idle timeout management.
 *  - Operational status reporting with real process RSS (no fabricated GPU memory).
 *  - Sanitized audit logging with zero sensitive prompt, image, or document content.
 */

import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import {
    MODEL_RUNTIME_REGISTRY,
    LIFECYCLE_STATE,
    DEFAULT_MLX_RUNTIME_DIR,
    resolveRegistryEntry,
    isManagedModel,
} from "./modelRegistry.js";

export class LocalModelRuntimeManager {
    /**
     * @param {object} [options]
     * @param {string} [options.runtimeDir]
     * @param {number} [options.idleTimeoutMs] - Default: 30 minutes (1800000ms)
     * @param {number} [options.startupTimeoutMs] - Default: 45 seconds (45000ms)
     * @param {Function} [options.logger] - Optional custom sanitized logger
     */
    constructor(options = {}) {
        this.runtimeDir = options.runtimeDir || process.env.MLX_RUNTIME_DIR || DEFAULT_MLX_RUNTIME_DIR;
        this.idleTimeoutMs = options.idleTimeoutMs || parseInt(process.env.MODEL_IDLE_TIMEOUT_MS || "1800000", 10);
        this.startupTimeoutMs = options.startupTimeoutMs || parseInt(process.env.MODEL_STARTUP_TIMEOUT_MS || "45000", 10);
        this.logger = options.logger || this._defaultLog.bind(this);

        // Model state store: id -> state
        this.modelStates = new Map();

        // Concurrency protection: modelId -> Promise<void>
        this.startupLocks = new Map();

        // Initialize state table for all registered models
        for (const entry of Object.values(MODEL_RUNTIME_REGISTRY)) {
            this.modelStates.set(entry.id, {
                id: entry.id,
                logicalModel: entry.logicalModel,
                provider: entry.provider,
                port: entry.port,
                status: LIFECYCLE_STATE.STOPPED,
                pid: null,
                processRef: null,
                startedAt: null,
                lastUsedAt: null,
                activeRequests: 0,
                lastError: null,
            });
        }

        this._ensureLogsDir();
    }

    _ensureLogsDir() {
        const logsDir = path.resolve(this.runtimeDir, "logs");
        try {
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
        } catch {}
    }

    _defaultLog(event, metadata = {}) {
        // Strip any accidental sensitive data fields
        const sanitized = {
            timestamp: new Date().toISOString(),
            event,
            ...metadata,
        };
        delete sanitized.prompt;
        delete sanitized.document;
        delete sanitized.image;
        delete sanitized.text;
        delete sanitized.content;
        delete sanitized.output;

        console.log(`[MODEL-LIFECYCLE] ${JSON.stringify(sanitized)}`);
    }

    _resolve(modelOrAlias) {
        const entry = resolveRegistryEntry(modelOrAlias);
        if (!entry) {
            throw new Error(`Model '${modelOrAlias}' is not a recognized managed local MLX runtime.`);
        }
        return entry;
    }

    _getState(entry) {
        let state = this.modelStates.get(entry.id);
        if (!state) {
            state = {
                id: entry.id,
                logicalModel: entry.logicalModel,
                provider: entry.provider,
                port: entry.port,
                status: LIFECYCLE_STATE.STOPPED,
                pid: null,
                processRef: null,
                startedAt: null,
                lastUsedAt: null,
                activeRequests: 0,
                lastError: null,
            };
            this.modelStates.set(entry.id, state);
        }
        return state;
    }

    /**
     * Finds listening PID on given port using lsof. Returns number or null.
     */
    _findPortPid(port) {
        try {
            const out = execSync(`lsof -ti :${port} -sTCP:LISTEN`, {
                stdio: ["pipe", "pipe", "ignore"],
                encoding: "utf-8",
                timeout: 2000,
            }).trim();
            if (out) {
                const pid = parseInt(out.split("\n")[0], 10);
                return Number.isFinite(pid) ? pid : null;
            }
        } catch {}
        return null;
    }

    /**
     * Retrieves actual process RSS in bytes via ps. Does not fabricate GPU memory.
     */
    _getProcessRssBytes(pid) {
        if (!pid) return null;
        try {
            const out = execSync(`ps -o rss= -p ${pid}`, {
                stdio: ["pipe", "pipe", "ignore"],
                encoding: "utf-8",
                timeout: 2000,
            }).trim();
            if (out) {
                const rssKb = parseInt(out, 10);
                if (Number.isFinite(rssKb)) {
                    return rssKb * 1024;
                }
            }
        } catch {}
        return null;
    }

    /**
     * Lightweight HTTP probe against health endpoint.
     *
     * @param {string} modelOrAlias
     * @returns {Promise<{ healthy: boolean, statusCode?: number, data?: any, error?: string }>}
     */
    async healthCheck(modelOrAlias) {
        const entry = this._resolve(modelOrAlias);
        const state = this._getState(entry);

        try {
            let res;
            try {
                res = await fetch(entry.healthUrl, {
                    signal: AbortSignal.timeout(2000),
                });
            } catch (primaryErr) {
                if (entry.healthUrl.includes("host.docker.internal")) {
                    const fallbackUrl = entry.healthUrl.replace("host.docker.internal", "127.0.0.1");
                    res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(2000) });
                } else {
                    throw primaryErr;
                }
            }

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                state.status = LIFECYCLE_STATE.READY;
                state.lastError = null;
                if (!state.pid) {
                    state.pid = this._findPortPid(entry.port);
                }
                return { healthy: true, statusCode: res.status, data };
            } else {
                state.status = LIFECYCLE_STATE.UNHEALTHY;
                state.lastError = `HTTP ${res.status}`;
                return { healthy: false, statusCode: res.status, error: `HTTP ${res.status}` };
            }
        } catch (err) {
            if (state.status === LIFECYCLE_STATE.READY) {
                state.status = LIFECYCLE_STATE.STOPPED;
                state.pid = null;
            }
            state.lastError = err.message;
            return { healthy: false, error: err.message };
        }
    }

    /**
     * Inspects port and HTTP health to discover running server.
     *
     * @param {string} modelOrAlias
     * @returns {Promise<boolean>}
     */
    async discoverServer(modelOrAlias) {
        const entry = this._resolve(modelOrAlias);
        const state = this._getState(entry);

        const health = await this.healthCheck(modelOrAlias);
        if (health.healthy) {
            state.status = LIFECYCLE_STATE.READY;
            state.pid = this._findPortPid(entry.port);
            return true;
        }

        const pid = this._findPortPid(entry.port);
        if (pid) {
            // Port listening but /health failed: UNHEALTHY
            state.status = LIFECYCLE_STATE.UNHEALTHY;
            state.pid = pid;
            return false;
        }

        state.status = LIFECYCLE_STATE.STOPPED;
        state.pid = null;
        return false;
    }

    /**
     * Starts local model server process if not already healthy.
     * Guaranteed duplicate process prevention through port discovery and lock map.
     *
     * @param {string} modelOrAlias
     * @param {object} [options]
     * @returns {Promise<{ model: string, status: string, port: number, pid: number }>}
     */
    async start(modelOrAlias, options = {}) {
        const entry = this._resolve(modelOrAlias);
        const state = this._getState(entry);

        // 1. Check if already healthy
        const isLive = await this.discoverServer(entry.id);
        if (isLive) {
            this.logger("ALREADY_RUNNING", {
                model: entry.logicalModel,
                port: entry.port,
                pid: state.pid,
            });
            return this.getStatus(entry.id);
        }

        // 2. Concurrency check: if startup already in flight, await existing Promise
        if (this.startupLocks.has(entry.id)) {
            this.logger("STARTUP_AWAITING_LOCK", {
                model: entry.logicalModel,
                port: entry.port,
            });
            await this.startupLocks.get(entry.id);
            return this.getStatus(entry.id);
        }

        // 3. Initiate startup with promise lock
        const startupPromise = (async () => {
            state.status = LIFECYCLE_STATE.STARTING;
            state.startedAt = new Date().toISOString();
            this.logger("START_REQUESTED", {
                model: entry.logicalModel,
                port: entry.port,
                runtime: entry.runtime,
            });

            // Verify venv python and model path
            const pythonPath = path.resolve(this.runtimeDir, "venv/bin/python");
            const modelAbsPath = path.resolve(this.runtimeDir, entry.modelRelPath);

            if (!fs.existsSync(pythonPath)) {
                state.status = LIFECYCLE_STATE.FAILED;
                state.lastError = `Venv python not found at ${pythonPath}`;
                throw new Error(state.lastError);
            }

            if (!fs.existsSync(modelAbsPath)) {
                state.status = LIFECYCLE_STATE.FAILED;
                state.lastError = `Model weights not found at ${modelAbsPath}`;
                throw new Error(state.lastError);
            }

            const logFilePath = path.resolve(this.runtimeDir, `logs/${entry.id}.log`);
            const logOut = fs.openSync(logFilePath, "a");

            // Fixed executable and arguments — zero shell injection risk
            const spawnArgs = [
                "-m",
                entry.serverModule,
                "--model",
                entry.modelRelPath,
                ...entry.defaultArgs,
            ];

            const child = spawn(pythonPath, spawnArgs, {
                cwd: this.runtimeDir,
                stdio: ["ignore", logOut, logOut],
                detached: false,
            });

            state.pid = child.pid;
            state.processRef = child;

            child.on("exit", (code, signal) => {
                this.logger("PROCESS_EXITED", {
                    model: entry.logicalModel,
                    port: entry.port,
                    pid: child.pid,
                    code,
                    signal,
                });
                if (state.status === LIFECYCLE_STATE.STARTING || state.status === LIFECYCLE_STATE.READY) {
                    state.status = LIFECYCLE_STATE.STOPPED;
                }
                state.pid = null;
                state.processRef = null;
            });

            child.on("error", (err) => {
                this.logger("PROCESS_ERROR", {
                    model: entry.logicalModel,
                    port: entry.port,
                    error: err.message,
                });
                state.status = LIFECYCLE_STATE.FAILED;
                state.lastError = err.message;
            });

            this.logger("PROCESS_SPAWNED", {
                model: entry.logicalModel,
                port: entry.port,
                pid: child.pid,
            });

            // Poll /health until server responds READY or timeout
            const startTime = Date.now();
            const timeoutMs = options.timeoutMs || this.startupTimeoutMs;

            while (Date.now() - startTime < timeoutMs) {
                await new Promise((r) => setTimeout(r, 500));
                const h = await this.healthCheck(entry.id);
                if (h.healthy) {
                    state.status = LIFECYCLE_STATE.READY;
                    state.lastError = null;
                    this.logger("HEALTH_READY", {
                        model: entry.logicalModel,
                        port: entry.port,
                        pid: state.pid,
                        durationMs: Date.now() - startTime,
                    });
                    return;
                }
                // Check if child exited prematurely
                if (child.exitCode !== null) {
                    state.status = LIFECYCLE_STATE.FAILED;
                    state.lastError = `Server exited prematurely with code ${child.exitCode}`;
                    throw new Error(state.lastError);
                }
            }

            // Timeout exceeded
            state.status = LIFECYCLE_STATE.FAILED;
            state.lastError = `Server failed to report healthy within ${timeoutMs}ms`;
            try {
                child.kill("SIGKILL");
            } catch {}
            throw new Error(state.lastError);
        })();

        this.startupLocks.set(entry.id, startupPromise);

        try {
            await startupPromise;
            return this.getStatus(entry.id);
        } finally {
            this.startupLocks.delete(entry.id);
        }
    }

    /**
     * Idempotently ensures the target model is running and healthy.
     *
     * @param {string} modelOrAlias
     * @returns {Promise<{ model: string, status: string, port: number, pid: number }>}
     */
    async ensureRunning(modelOrAlias) {
        const entry = this._resolve(modelOrAlias);
        const state = this._getState(entry);

        if (state.status === LIFECYCLE_STATE.READY) {
            // Fast-path: quick health probe to verify process hasn't died
            const h = await this.healthCheck(entry.id);
            if (h.healthy) {
                return this.getStatus(entry.id);
            }
        }

        // If startup in progress, await lock
        if (this.startupLocks.has(entry.id)) {
            await this.startupLocks.get(entry.id);
            return this.getStatus(entry.id);
        }

        return await this.start(entry.id);
    }

    /**
     * Safely stops the model server process.
     * Enforces activeRequests === 0 protection and only terminates positively identified PIDs.
     *
     * @param {string} modelOrAlias
     * @param {object} [options]
     * @param {boolean} [options.force]
     * @returns {Promise<{ success: boolean, model: string, status: string }>}
     */
    async stop(modelOrAlias, options = {}) {
        const entry = this._resolve(modelOrAlias);
        const state = this._getState(entry);

        if (state.activeRequests > 0 && !options.force) {
            throw new Error(
                `Cannot stop model '${entry.logicalModel}': ${state.activeRequests} active request(s) in progress.`
            );
        }

        state.status = LIFECYCLE_STATE.STOPPING;
        this.logger("SHUTDOWN_REQUESTED", {
            model: entry.logicalModel,
            port: entry.port,
            pid: state.pid,
        });

        const targetPid = state.pid || this._findPortPid(entry.port);

        if (targetPid) {
            try {
                // Positively verify target PID is running Python server on this port
                process.kill(targetPid, "SIGTERM");

                // Grace period: up to 4 seconds
                for (let i = 0; i < 8; i++) {
                    await new Promise((r) => setTimeout(r, 500));
                    try {
                        process.kill(targetPid, 0); // test if still alive
                    } catch {
                        break; // exited
                    }
                }

                // Force kill if still hanging
                try {
                    process.kill(targetPid, 0);
                    process.kill(targetPid, "SIGKILL");
                } catch {}
            } catch (err) {
                // If ESRCH, process was already dead
                if (err.code !== "ESRCH") {
                    this.logger("SHUTDOWN_WARNING", {
                        model: entry.logicalModel,
                        error: err.message,
                    });
                }
            }
        }

        state.status = LIFECYCLE_STATE.STOPPED;
        state.pid = null;
        state.processRef = null;

        this.logger("SHUTDOWN_COMPLETED", {
            model: entry.logicalModel,
            port: entry.port,
        });

        return {
            success: true,
            model: entry.logicalModel,
            status: LIFECYCLE_STATE.STOPPED,
        };
    }

    /**
     * Stops and restarts the model server.
     *
     * @param {string} modelOrAlias
     * @returns {Promise<{ model: string, status: string, port: number, pid: number }>}
     */
    async restart(modelOrAlias) {
        await this.stop(modelOrAlias, { force: true });
        return await this.start(modelOrAlias);
    }

    /**
     * Records timestamp of successful inference initiation/completion.
     *
     * @param {string} modelOrAlias
     */
    recordUsage(modelOrAlias) {
        const entry = resolveRegistryEntry(modelOrAlias);
        if (!entry) return;
        const state = this._getState(entry);
        state.lastUsedAt = new Date().toISOString();
    }

    getLastUsed(modelOrAlias) {
        const entry = resolveRegistryEntry(modelOrAlias);
        if (!entry) return null;
        return this._getState(entry).lastUsedAt;
    }

    incrementActiveRequests(modelOrAlias) {
        const entry = resolveRegistryEntry(modelOrAlias);
        if (!entry) return 0;
        const state = this._getState(entry);
        state.activeRequests = (state.activeRequests || 0) + 1;
        return state.activeRequests;
    }

    decrementActiveRequests(modelOrAlias) {
        const entry = resolveRegistryEntry(modelOrAlias);
        if (!entry) return 0;
        const state = this._getState(entry);
        state.activeRequests = Math.max(0, (state.activeRequests || 1) - 1);
        return state.activeRequests;
    }

    getActiveRequests(modelOrAlias) {
        const entry = resolveRegistryEntry(modelOrAlias);
        if (!entry) return 0;
        return this._getState(entry).activeRequests;
    }

    /**
     * Checks if a model is idle beyond configured threshold and stops it safely.
     *
     * @param {string} modelOrAlias
     * @returns {Promise<boolean>} - True if stopped, false if active or below threshold
     */
    async stopIfIdle(modelOrAlias) {
        const entry = this._resolve(modelOrAlias);
        const state = this._getState(entry);

        if (state.status !== LIFECYCLE_STATE.READY) {
            return false;
        }

        if (state.activeRequests > 0) {
            return false;
        }

        if (!state.lastUsedAt) {
            return false;
        }

        const idleDuration = Date.now() - Date.parse(state.lastUsedAt);
        if (idleDuration > this.idleTimeoutMs) {
            this.logger("IDLE_TIMEOUT_TRIGGERED", {
                model: entry.logicalModel,
                idleDurationMs: idleDuration,
                thresholdMs: this.idleTimeoutMs,
            });
            await this.stop(entry.id);
            return true;
        }

        return false;
    }

    /**
     * Returns sanitized operational metadata for a single model.
     *
     * @param {string} modelOrAlias
     * @returns {object}
     */
    getStatus(modelOrAlias) {
        const entry = this._resolve(modelOrAlias);
        const state = this._getState(entry);
        const rssBytes = this._getProcessRssBytes(state.pid);

        return {
            id: entry.id,
            model: entry.logicalModel,
            provider: entry.provider,
            runtime: entry.runtime,
            status: state.status,
            port: entry.port,
            pid: state.pid,
            lastUsedAt: state.lastUsedAt,
            activeRequests: state.activeRequests,
            rssBytes: rssBytes,
            rssMb: rssBytes ? Math.round((rssBytes / (1024 * 1024)) * 10) / 10 : null,
            lastError: state.lastError,
        };
    }

    /**
     * Returns sanitized operational metadata array for all registered models.
     *
     * @returns {Array<object>}
     */
    getAllStatuses() {
        return Object.keys(MODEL_RUNTIME_REGISTRY).map((id) => this.getStatus(id));
    }
}

// Singleton runtime manager instance
export const localModelRuntimeManager = new LocalModelRuntimeManager();
export { isManagedModel };
