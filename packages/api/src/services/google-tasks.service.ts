import { google } from 'googleapis';
import { getGoogleConfig, getAuthorizedGoogleClient } from './google-calendar.service.js';

function getTasksClient() {
  return google.tasks({ version: 'v1', auth: getAuthorizedGoogleClient() });
}

export async function listTaskLists() {
  const tasks = getTasksClient();
  const res = await tasks.tasklists.list();
  return (res.data.items || []).map((tl) => ({ id: tl.id, title: tl.title }));
}

export async function createTask(params: { title: string; notes?: string; due?: string }) {
  const config = getGoogleConfig();
  const taskListId = config.task_list_id || '@default';
  const tasks = getTasksClient();

  const res = await tasks.tasks.insert({
    tasklist: taskListId,
    requestBody: {
      title: params.title,
      notes: params.notes,
      // Tasks API only honors the date part of `due` — it always renders as a due date, not a due time.
      due: params.due,
    },
  });

  return { taskId: res.data.id, title: res.data.title };
}

export async function getTask(taskId: string) {
  const config = getGoogleConfig();
  const taskListId = config.task_list_id || '@default';
  const tasks = getTasksClient();

  const res = await tasks.tasks.get({ tasklist: taskListId, task: taskId });
  return { id: res.data.id, title: res.data.title, status: res.data.status };
}

export async function setTaskStatus(taskId: string, completed: boolean) {
  const config = getGoogleConfig();
  const taskListId = config.task_list_id || '@default';
  const tasks = getTasksClient();

  const res = await tasks.tasks.patch({
    tasklist: taskListId,
    task: taskId,
    requestBody: { status: completed ? 'completed' : 'needsAction' },
  });

  return { taskId: res.data.id, status: res.data.status };
}

export async function listTasks(params: { showCompleted?: boolean } = {}) {
  const config = getGoogleConfig();
  const taskListId = config.task_list_id || '@default';
  const tasks = getTasksClient();

  const res = await tasks.tasks.list({
    tasklist: taskListId,
    showCompleted: params.showCompleted ?? false,
  });

  return (res.data.items || []).map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    due: t.due,
    status: t.status,
  }));
}
