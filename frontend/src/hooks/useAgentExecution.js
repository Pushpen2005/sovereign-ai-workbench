/**
 * HOOK LAYER — useAgentExecution.js
 *
 * Manages autonomous tool agent execution with real-time LangGraph SSE streaming,
 * timeline event normalization, and terminal result handling.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { runAgent as runAgentApi } from '../api/agent.api.js';
import { subscribeToSse } from '../services/sseClient.js';

export function useAgentExecution() {
  const [status, setStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  const [goal, setGoal] = useState('');
  const [runId, setRunId] = useState(null);
  const [model, setModel] = useState('llama3.2:3b');
  const [currentStep, setCurrentStep] = useState(0);
  const [maxSteps, setMaxSteps] = useState(5);
  const [timeline, setTimeline] = useState([]);
  const [finalAnswer, setFinalAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [steps, setSteps] = useState([]);
  const [deliverable, setDeliverable] = useState(null);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState(null);
  const [stoppedReason, setStoppedReason] = useState(null);

  const unsubscribeRef = useRef(null);

  // Clean up SSE connection on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  /**
   * Appends an event to the timeline, preventing duplicate identical entries.
   */
  const appendTimelineEvent = useCallback((event) => {
    setTimeline((prev) => {
      // Check if duplicate
      if (event.id && prev.some((e) => e.id === event.id)) {
        return prev;
      }
      return [...prev, event];
    });
  }, []);

  /**
   * Normalizes raw backend SSE events into human-readable timeline items.
   */
  const handleSseEvent = useCallback((sseEvent) => {
    const { type, data, timestamp } = sseEvent;
    if (type === 'heartbeat') return;

    const eventId = sseEvent.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (type === 'connected') {
      appendTimelineEvent({
        id: eventId,
        type: 'connected',
        label: 'Connected to live LangGraph execution stream',
        status: 'complete',
        timestamp,
      });
    } else if (type === 'run_started') {
      setStatus('running');
      if (data?.model) setModel(data.model);
      if (data?.maxSteps) setMaxSteps(data.maxSteps);
      appendTimelineEvent({
        id: eventId,
        type: 'run_started',
        label: `Agent initialized (${data?.engine || 'LangGraph'} engine)`,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'node_started') {
      const nodeName = data?.node || 'node';
      let label = `Running ${nodeName}`;
      if (nodeName === 'reason') label = `Reasoning & planning next action (Step ${data?.step || 1})`;
      else if (nodeName === 'execute_tool') label = 'Executing agent tool';
      else if (nodeName === 'validate_tool_result') label = 'Validating tool results & evidence';
      else if (nodeName === 'final_answer') label = 'Preparing final answer synthesis';

      appendTimelineEvent({
        id: eventId,
        type: 'node_started',
        node: nodeName,
        step: data?.step,
        label,
        status: 'running',
        timestamp,
      });
    } else if (type === 'node_completed') {
      const nodeName = data?.node || 'node';
      let label = `Completed ${nodeName}`;
      if (nodeName === 'reason') label = `Reasoning step finished${data?.actionType ? ` (action: ${data.actionType})` : ''}`;
      else if (nodeName === 'execute_tool') label = 'Tool execution completed';
      else if (nodeName === 'validate_tool_result') label = 'Tool output validated';
      else if (nodeName === 'final_answer') label = 'Final answer compiled';

      if (data?.step) setCurrentStep(data.step);

      appendTimelineEvent({
        id: eventId,
        type: 'node_completed',
        node: nodeName,
        step: data?.step,
        label,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'tool_started') {
      const tool = data?.tool || 'tool';
      appendTimelineEvent({
        id: eventId,
        type: 'tool_started',
        tool,
        label: `Invoking tool: ${tool}`,
        details: data?.arguments ? JSON.stringify(data.arguments) : null,
        status: 'running',
        timestamp,
      });
    } else if (type === 'tool_completed') {
      const tool = data?.tool || 'tool';
      const duration = data?.durationMs ? ` (${data.durationMs}ms)` : '';
      appendTimelineEvent({
        id: eventId,
        type: 'tool_completed',
        tool,
        label: `Tool '${tool}' completed successfully${duration}`,
        status: 'complete',
        durationMs: data?.durationMs,
        timestamp,
      });
    } else if (type === 'run_completed') {
      setStatus('completed');
      setStoppedReason(data?.stoppedReason || 'completed');
      if (data?.totalSteps) setCurrentStep(data.totalSteps);
      if (data?.durationMs) setDurationMs(data.durationMs);
      if (data?.answer) setFinalAnswer(data.answer);

      appendTimelineEvent({
        id: eventId,
        type: 'run_completed',
        label: 'Agent completed execution successfully',
        status: 'complete',
        timestamp,
      });
    } else if (type === 'run_stopped') {
      setStatus('stopped');
      setStoppedReason(data?.stoppedReason || 'stopped');
      appendTimelineEvent({
        id: eventId,
        type: 'run_stopped',
        label: `Agent execution stopped: ${data?.stoppedReason || 'bounded limit reached'}`,
        status: 'warning',
        timestamp,
      });
    } else if (type === 'run_failed') {
      setStatus('failed');
      setError(data?.reason || 'Agent execution encountered an error');
      appendTimelineEvent({
        id: eventId,
        type: 'run_failed',
        label: `Agent failure: ${data?.reason || 'Execution failed'}`,
        status: 'error',
        timestamp,
      });
    }
  }, [appendTimelineEvent]);

  /**
   * Execute an agent run.
   */
  const executeAgent = useCallback(async (promptGoal, options = {}) => {
    if (!promptGoal || !promptGoal.trim() || status === 'running') {
      return;
    }

    const cleanGoal = promptGoal.trim();
    const cleanRunId = options.runId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    setGoal(cleanGoal);
    setRunId(cleanRunId);
    setStatus('running');
    setTimeline([]);
    setFinalAnswer('');
    setSources([]);
    setSteps([]);
    setDeliverable(null);
    setError(null);
    setStoppedReason(null);
    setCurrentStep(0);

    // 1. Establish SSE stream connection before/concurrently with POST
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    unsubscribeRef.current = subscribeToSse(`/api/v1/agent/runs/${cleanRunId}/stream`, {
      onEvent: handleSseEvent,
      onError: (err) => {
        // SSE error is non-fatal; POST response is authoritative
        console.warn('[useAgentExecution] SSE warning:', err.message);
      },
      onClose: () => {
        // stream closed cleanly
      },
    });

    // 2. Invoke POST API
    try {
      const result = await runAgentApi(cleanGoal, {
        runId: cleanRunId,
        maxSteps: options.maxSteps || maxSteps,
        timeoutMs: options.timeoutMs,
      });

      if (result) {
        if (result.answer) setFinalAnswer(result.answer);
        if (Array.isArray(result.sources)) setSources(result.sources);
        if (Array.isArray(result.steps)) setSteps(result.steps);
        if (result.deliverable) setDeliverable(result.deliverable);
        if (result.totalSteps) setCurrentStep(result.totalSteps);
        if (result.durationMs) setDurationMs(result.durationMs);
        if (result.model) setModel(result.model);
        if (result.stoppedReason) setStoppedReason(result.stoppedReason);

        if (result.success) {
          setStatus('completed');
        } else if (result.stoppedReason === 'max_steps_reached' || result.stoppedReason === 'timeout') {
          setStatus('stopped');
        } else {
          setStatus('failed');
          setError(result.answer || 'Execution stopped without normal completion');
        }
      }
    } catch (err) {
      setStatus('failed');
      setError(err?.message || 'Agent execution failed');
      appendTimelineEvent({
        id: `err-${Date.now()}`,
        type: 'run_failed',
        label: `Execution error: ${err?.message || 'Network error'}`,
        status: 'error',
        timestamp: Date.now(),
      });
    }
  }, [status, maxSteps, handleSseEvent, appendTimelineEvent]);

  const reset = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setStatus('idle');
    setGoal('');
    setRunId(null);
    setTimeline([]);
    setFinalAnswer('');
    setSources([]);
    setSteps([]);
    setDeliverable(null);
    setError(null);
    setStoppedReason(null);
    setCurrentStep(0);
  }, []);

  return {
    status,
    goal,
    runId,
    model,
    currentStep,
    maxSteps,
    timeline,
    finalAnswer,
    sources,
    steps,
    deliverable,
    durationMs,
    error,
    stoppedReason,
    isRunning: status === 'running',
    isCompleted: status === 'completed',
    isFailed: status === 'failed',
    isStopped: status === 'stopped',
    executeAgent,
    reset,
  };
}
