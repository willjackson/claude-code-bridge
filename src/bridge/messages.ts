/**
 * Message builder factory functions for Claude Code Bridge
 * Provides convenient functions to create specific message types
 */

import { createMessage, type BridgeMessage, type Context, type TaskRequest, type TaskResult } from './protocol.js';

/**
 * Notification data structure for notification messages
 */
export interface NotificationData {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Creates a context synchronization message
 * Used to share context (files, tree, summary) with a peer
 * @param source The source instance identifier
 * @param context The context to synchronize
 * @returns A BridgeMessage with type 'context_sync'
 */
export function createContextSyncMessage(
  source: string,
  context: Context
): BridgeMessage {
  const message = createMessage('context_sync', source);
  return {
    ...message,
    context,
  };
}

/**
 * Creates a task delegation message
 * Used to delegate a task to a peer instance
 * @param source The source instance identifier
 * @param task The task to delegate
 * @returns A BridgeMessage with type 'task_delegate'
 */
export function createTaskDelegateMessage(
  source: string,
  task: TaskRequest
): BridgeMessage {
  const message = createMessage('task_delegate', source);
  return {
    ...message,
    task,
  };
}

/**
 * Creates a task response message
 * Used to respond to a delegated task
 * @param source The source instance identifier
 * @param taskId The ID of the task being responded to
 * @param result The result of the task execution
 * @returns A BridgeMessage with type 'response'
 */
export function createTaskResponseMessage(
  source: string,
  taskId: string,
  result: Omit<TaskResult, 'taskId'>
): BridgeMessage {
  const message = createMessage('response', source);
  return {
    ...message,
    result: {
      ...result,
      taskId,
    },
  };
}

/**
 * Creates a context request message
 * Used to request specific context from a peer
 * @param source The source instance identifier
 * @param query A description of what context is being requested
 * @returns A BridgeMessage with type 'request'
 */
export function createContextRequestMessage(
  source: string,
  query: string
): BridgeMessage {
  const message = createMessage('request', source);
  return {
    ...message,
    context: {
      summary: query,
    },
  };
}

/**
 * Creates a notification message
 * Used to send notifications to peers (events, status updates, etc.)
 * @param source The source instance identifier
 * @param notification The notification data
 * @returns A BridgeMessage with type 'notification'
 */
export function createNotificationMessage(
  source: string,
  notification: NotificationData
): BridgeMessage {
  const message = createMessage('notification', source);
  return {
    ...message,
    context: {
      summary: notification.message,
      variables: {
        notificationType: notification.type,
        ...notification.data,
      },
    },
  };
}
