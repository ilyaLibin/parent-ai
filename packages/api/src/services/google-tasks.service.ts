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
