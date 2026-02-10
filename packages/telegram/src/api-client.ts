const API_BASE = process.env.API_URL || 'http://localhost:3033';

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// --- Types ---

interface GroupInfo {
  id: string;
  name: string;
  messageCount: number;
}

interface StatusResult {
  gaps: { start: number; end: number; duration_minutes: number }[];
  groupCount: number;
  totalMessages: number;
}

interface SummaryResult {
  groupsSummarized: number;
  errors: string[];
}

interface AgentReportResult {
  success: boolean;
  steps: number;
  error?: string;
}

// --- API methods ---

export async function getGroups(): Promise<{ groups: GroupInfo[] }> {
  return request('/groups');
}

export async function getStatus(hours = 24): Promise<StatusResult> {
  return request(`/status?hours=${hours}`);
}

export async function triggerDailySummary(): Promise<SummaryResult> {
  return request('/summary/daily', { method: 'POST' });
}

export async function triggerAvivSchoolSummary(): Promise<SummaryResult> {
  return request('/summary/aviv_school', { method: 'POST' });
}

export async function triggerDailyReport(): Promise<AgentReportResult> {
  return request('/summary/agent/daily-report', { method: 'POST' });
}
