/**
 * API client for communicating with the running listener process
 */

const API_BASE = process.env.API_URL || 'http://localhost:3033';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body } = options;

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    return { success: true, data };
  } catch (error) {
    if (error instanceof Error && error.cause && (error.cause as any).code === 'ECONNREFUSED') {
      return {
        success: false,
        error: 'Cannot connect to listener. Is "npm run dev" running?',
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  to?: string;
  error?: string;
}

export async function sendMessage(to: string, message: string): Promise<SendResult> {
  const result = await request<SendResult>('/send', {
    method: 'POST',
    body: { to, message },
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return result.data as SendResult;
}

export interface HealthResult {
  status: string;
  connected: boolean;
  timestamp: number;
}

export async function checkHealth(): Promise<ApiResponse<HealthResult>> {
  return request<HealthResult>('/health');
}

export interface Group {
  id: string;
  name: string;
  updated_at: number;
  messageCount: number;
}

export async function getGroups(): Promise<ApiResponse<{ groups: Group[] }>> {
  return request<{ groups: Group[] }>('/groups');
}

export interface StatusResult {
  connected: boolean;
  gaps: { start: number; end: number; duration_minutes: number }[];
  groupCount: number;
  totalMessages: number;
}

export async function getStatus(hours = 24): Promise<ApiResponse<StatusResult>> {
  return request<StatusResult>(`/status?hours=${hours}`);
}

export function phoneToJid(phone: string): string {
  const cleaned = phone.replace(/[^\d]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}
