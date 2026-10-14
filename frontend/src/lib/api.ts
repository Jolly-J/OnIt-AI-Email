const API_BASE = '/api';

export interface User {
  id: number;
  username: string;
  display_name: string;
  avatar?: string;
  dingtalk_userid?: string;
  job_number?: string;
  department_name?: string;
  is_admin?: boolean;
  is_active?: boolean;
}

export interface AdminUserItem {
  id: number;
  username: string;
  display_name: string;
  avatar: string | null;
  dingtalk_userid: string | null;
  mobile: string | null;
  email: string | null;
  job_number: string | null;
  department_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string | null;
}

export interface MailAccount {
  id: number;
  provider: string;
  name: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string | null;
}

export interface EmailListItem {
  id: number;
  account_id: number;
  account_name: string;
  provider: string;
  subject: string;
  sender: string;
  to_recipients: string;
  sent_date: string;
  summary_zh: string;
  key_points: string[];
  ai_guided_question: string;
  is_read: boolean;
  folder?: string;
  status: 'inbox' | 'sent' | 'drafts' | 'trash' | 'replied' | 'archived';
  created_at: string;
}

export interface EmailDetail {
  id: number;
  account_id: number;
  account_email: string;
  account_name: string;
  subject: string;
  sender: string;
  to_recipients: string;
  cc_recipients: string;
  bcc_recipients?: string;
  sent_date: string;
  body_text: string;
  body_html: string;
  language_detected: string;
  summary_zh: string;
  translated_subject?: string;
  translated_body_text?: string;
  translated_body_html?: string;
  key_points: string[];
  action_items: string[];
  ai_guided_question: string;
  initial_reply_draft: string;
  is_read: boolean;
  folder?: string;
  status: 'inbox' | 'sent' | 'drafts' | 'trash' | 'replied' | 'archived';
  created_at: string;
}

export interface ChatMessageItem {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  draft_reply: string;
  draft_reply_zh?: string;
  explanation?: string;
  created_at: string;
}

export interface EmailAttachmentPayload {
  filename: string;
  content_base64?: string;
  content_type?: string;
  size?: number;
  is_large?: boolean;
  large_token?: string;
  download_url?: string;
  expires_at?: string;
}

export interface UploadLargeAttachmentResult {
  token: string;
  filename: string;
  size: number;
  formatted_size: string;
  download_url: string;
  expires_at: string;
  days_valid: number;
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('email_agent_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...getAuthHeader(),
    ...((options.headers as Record<string, string>) || {}),
  };
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem('email_agent_token');
    window.dispatchEvent(new Event('auth:unauthorized'));
    throw new Error('登录凭据已过期，请重新登录');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || '请求失败，请稍后重试');
  }

  return data;
}

export const api = {
  auth: {
    login: (body: { username: string; password: string }) =>
      request<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    register: (body: { username: string; password: string; display_name?: string }) =>
      request<{ access_token: string; user: User }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getMe: () => request<User>('/auth/me'),
    mockLogin: () =>
      request<{ access_token: string; token_type: string; user: User }>('/auth/mock-login', {
        method: 'POST',
      }),
  },
  accounts: {
    list: () => request<MailAccount[]>('/accounts'),
    getPresets: () => request<Record<string, any>>('/accounts/presets'),
    test: (body: any) => request<{ success: boolean; message: string }>('/accounts/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    create: (body: any) => request<any>('/accounts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    delete: (id: number) => request<{ message: string }>(`/accounts/${id}`, {
      method: 'DELETE',
    }),
    sync: (id: number) => request<{ message: string }>(`/accounts/${id}/sync`, {
      method: 'POST',
    }),
    updateName: (id: number, name: string) => request<{ id: number; name: string; email_address: string; message: string }>(`/accounts/${id}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  },
  emails: {
    getCounts: (accountId?: number | null) => {
      const qp = new URLSearchParams();
      if (accountId) qp.set('account_id', String(accountId));
      return request<{
        inbox_total: number;
        inbox_unread: number;
        inbox_read: number;
        sent_total: number;
        drafts_total: number;
        trash_total: number;
        replied_total: number;
        archived_total: number;
      }>(`/emails/counts?${qp.toString()}`);
    },
    list: (
      params: { account_id?: number | null; folder?: string; status?: string; unread_only?: boolean; read_filter?: string; q?: string; limit?: number; offset?: number },
      signal?: AbortSignal
    ) => {
      const qp = new URLSearchParams();
      if (params.account_id) qp.set('account_id', String(params.account_id));
      if (params.folder) qp.set('folder', params.folder);
      if (params.status) qp.set('status', params.status);
      if (params.unread_only) qp.set('unread_only', 'true');
      if (params.read_filter) qp.set('read_filter', params.read_filter);
      if (params.q) qp.set('q', params.q);
      if (params.limit !== undefined) qp.set('limit', String(params.limit));
      if (params.offset !== undefined) qp.set('offset', String(params.offset));
      return request<{ total: number; items: EmailListItem[] }>(`/emails?${qp.toString()}`, { signal });
    },
    getDetail: (id: number) => request<EmailDetail>(`/emails/${id}`),
    reanalyze: (id: number) => request<any>(`/emails/${id}/reanalyze`, {
      method: 'POST',
    }),
    translate: (id: number, target_lang: string = 'zh') =>
      request<{
        success: boolean;
        translated_subject: string;
        translated_body_html: string;
        translated_body_text: string;
      }>(`/emails/${id}/translate`, {
        method: 'POST',
        body: JSON.stringify({ target_lang }),
      }),
    toggleRead: (id: number) => request<{ is_read: boolean }>(`/emails/${id}/read`, {
      method: 'PUT',
    }),
    archive: (id: number) => request<{ status: string; message: string }>(`/emails/${id}/archive`, {
      method: 'PUT',
    }),
    uploadLargeAttachment: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return request<UploadLargeAttachmentResult>('/emails/attachments/upload', {
        method: 'POST',
        body: formData,
      });
    },
    compose: (body: {
      account_id: number;
      to_email: string;
      cc_email?: string;
      bcc_email?: string;
      subject: string;
      body_text: string;
      body_html?: string;
      attachments?: EmailAttachmentPayload[];
      in_reply_to_email_id?: number;
    }) =>
      request<{ message: string; email_id?: number; delivery_warning?: string | null }>('/emails/compose', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    syncAll: () => request<{ message: string }>('/emails/sync_all', {
      method: 'POST',
    }),
    loadMore: (body: { account_id?: number | null; folder?: string; limit?: number }) =>
      request<{ loaded_count: number; has_more: boolean; message: string }>('/emails/load_more', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  chat: {
    getHistory: (emailId: number) => request<ChatMessageItem[]>(`/chat/${emailId}`),
    sendMessage: (emailId: number, instruction: string, current_draft?: string) =>
      request<ChatMessageItem>(`/chat/${emailId}`, {
        method: 'POST',
        body: JSON.stringify({ instruction, current_draft }),
      }),
    sendReply: (emailId: number, reply_body: string, custom_subject?: string, cc_email = '', bcc_email = '') =>
      request<{ success: boolean; message: string; status: string; delivery_warning?: string | null }>(`/chat/${emailId}/send_reply`, {
        method: 'POST',
        body: JSON.stringify({ reply_body, custom_subject, cc_email, bcc_email }),
      }),
    composeWithAI: (body: {
      instruction: string;
      to_email?: string;
      subject?: string;
      current_draft?: string;
      chat_history?: { role: string; content: string }[];
      language_preference?: string;
    }) =>
      request<ChatMessageItem>('/chat/compose', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  dingtalk: {
    getConfig: () =>
      request<{ client_id: string; corp_id: string; mock_enabled?: boolean }>('/auth/dingtalk/config'),
    login: (body: { code: string; mode: 'internal' | 'qr' }) =>
      request<{ access_token: string; user: User }>('/auth/dingtalk/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  admin: {
    syncDingTalk: () =>
      request<{
        success: boolean;
        message: string;
        total_synced: number;
        added_count: number;
        updated_count: number;
      }>('/admin/dingtalk/sync', {
        method: 'POST',
      }),
    getUsers: (params?: { keyword?: string; status_filter?: string }) => {
      const qp = new URLSearchParams();
      if (params?.keyword) qp.set('keyword', params.keyword);
      if (params?.status_filter) qp.set('status_filter', params.status_filter);
      return request<AdminUserItem[]>(`/admin/users?${qp.toString()}`);
    },
    toggleAccess: (userId: number, isActive: boolean) =>
      request<{ id: number; is_active: boolean }>(`/admin/users/${userId}/access`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: isActive }),
      }),
    toggleAdmin: (userId: number, isAdmin: boolean) =>
      request<{ id: number; is_admin: boolean }>(`/admin/users/${userId}/admin`, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: isAdmin }),
      }),
  },
  calendar: {
    getRooms: (params?: { date?: string; startTime?: string; endTime?: string }) => {
      const qp = new URLSearchParams();
      if (params?.date) qp.set('meeting_date', params.date);
      if (params?.startTime) qp.set('start_time', params.startTime);
      if (params?.endTime) qp.set('end_time', params.endTime);
      return request<{ rooms: MeetingRoomItem[]; date?: string; time_range?: string }>(`/calendar/rooms?${qp.toString()}`);
    },
    checkRoom: (body: { room_id: string; meeting_date: string; start_time: string; end_time: string }) =>
      request<{ room_id: string; is_available: boolean; message: string }>('/calendar/rooms/check', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createMeeting: (body: CreateMeetingParams) =>
      request<CreateMeetingResult>('/calendar/meetings', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    extractProposal: (body: { content: string; email_subject?: string }) =>
      request<MeetingProposalResult>('/calendar/extract-proposal', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getContacts: (query?: string) => {
      const qp = new URLSearchParams();
      if (query) qp.set('query', query);
      return request<InternalContactItem[]>(`/calendar/contacts?${qp.toString()}`);
    },
  },
};

export interface InternalContactItem {
  id: number;
  name: string;
  userid: string;
  unionid?: string;
  avatar: string;
  department: string;
  job_number: string;
  mobile: string;
  email: string;
}

export interface MeetingRoomItem {
  id: string;
  name: string;
  capacity: number;
  building: string;
  floor: string;
  is_available?: boolean;
  status_message?: string;
}

export interface CreateMeetingParams {
  summary: string;
  description?: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  room_id?: string;
  room_name?: string;
  attendee_mobiles?: string[];
  attendee_userids?: string[];
  attendee_emails?: string[];
  enable_video_meeting?: boolean;
  send_ics_email?: boolean;
  email_account_id?: number;
}

export interface CreateMeetingResult {
  success: boolean;
  dingtalk_event?: any;
  calendar_url?: string;
  organizer_name?: string;
  video_meeting?: {
    url: string;
    conference_id: string;
  };
  oa_booking: {
    booked: boolean;
    status_type?: 'direct_booked' | 'approval_pending' | 'failed' | 'none';
    meetingid?: string;
    requestid: string;
    message: string;
  };
  email_notice: {
    sent: boolean;
    message: string;
  };
  message: string;
}

export interface MeetingProposalResult {
  is_meeting: boolean;
  summary: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  description: string;
  attendee_mobiles: string[];
  attendee_emails: string[];
  confidence: number;
}
