// Thin typed fetch client. Response/request shapes come from the OpenAPI
// schema (src/api/types.ts, generated via `npm run gen:types`) — we don't
// hand-maintain parallel types.
import type { components } from "./types";

export type User = components["schemas"]["UserOut"];
export type AgentSummary = components["schemas"]["AgentSummary"];
export type AgentResponse = components["schemas"]["AgentResponse"];
export type AgentRequest = components["schemas"]["AgentRequest"];
export type Proposal = components["schemas"]["Proposal"];
export type Artifact = components["schemas"]["Artifact"];
export type RegisterIn = components["schemas"]["RegisterIn"];
export type LoginIn = components["schemas"]["LoginIn"];
export type Project = components["schemas"]["ProjectOut"];
export type ProjectIn = components["schemas"]["ProjectIn"];
export type Task = components["schemas"]["TaskOut"];
export type Message = components["schemas"]["MessageOut"];
export type SendMessageIn = components["schemas"]["SendMessageIn"];
export type ProposalRecord = components["schemas"]["ProposalOut"];

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Empty base = same-origin; in dev Vite proxies /api to the backend.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<User>("/api/auth/me"),
  register: (body: RegisterIn) =>
    request<User>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: LoginIn) =>
    request<User>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  listAgents: () => request<AgentSummary[]>("/api/agents"),
  runAgent: (agentId: string, body: AgentRequest) =>
    request<AgentResponse>(`/api/agents/${agentId}/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Projects + tasks
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (body: ProjectIn) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listTasks: (projectId: string) =>
    request<Task[]>(`/api/projects/${projectId}/tasks`),
  createTask: (projectId: string, title: string) =>
    request<Task>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  // Persisted conversation (project_id null = global context)
  getMessages: (agentId: string, projectId: string | null) =>
    request<Message[]>(
      `/api/agents/${agentId}/messages` +
        (projectId ? `?project_id=${projectId}` : ""),
    ),
  sendMessage: (agentId: string, body: SendMessageIn) =>
    request<Message>(`/api/agents/${agentId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Approval queue
  listApprovals: () => request<ProposalRecord[]>("/api/approvals"),
  approveProposal: (id: string) =>
    request<ProposalRecord>(`/api/approvals/${id}/approve`, { method: "POST" }),
  rejectProposal: (id: string) =>
    request<ProposalRecord>(`/api/approvals/${id}/reject`, { method: "POST" }),
};
