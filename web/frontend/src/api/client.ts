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
export type ProjectUpdate = components["schemas"]["ProjectUpdate"];
export type Task = components["schemas"]["TaskOut"];
export type Message = components["schemas"]["MessageOut"];
export type SendMessageIn = components["schemas"]["SendMessageIn"];
export type ProposalRecord = components["schemas"]["ProposalOut"];
export type TimelineNode = components["schemas"]["TimelineNode"];
export type FsTreeNode = components["schemas"]["FsTreeNode"];
export type SearchHit = components["schemas"]["SearchHit"];
export type FileOpResult = components["schemas"]["FileOpResult"];
export type TaskDoc = components["schemas"]["TaskDocOut"];
export type ContainerFile = components["schemas"]["ContainerFile"];
export type Home = components["schemas"]["HomeOut"];
export type FunctionInfo = components["schemas"]["FunctionOut"];
export type Company = components["schemas"]["CompanyOut"];

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
  // FormData sets its own multipart Content-Type (with boundary); don't force JSON.
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
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

  // Company Home + function streams (the warm-paper surfaces)
  home: () => request<Home>("/api/home"),
  listFunctions: () => request<FunctionInfo[]>("/api/functions"),
  getFunction: (key: string) =>
    request<FunctionInfo>(`/api/functions/${key}`),
  functionTimeline: (key: string, facet?: string | null) =>
    request<TimelineNode[]>(
      `/api/functions/${key}/timeline` +
        (facet ? `?facet=${encodeURIComponent(facet)}` : ""),
    ),
  functionTree: (key: string) =>
    request<FsTreeNode>(`/api/functions/${key}/tree`),
  searchFunction: (key: string, q: string, semantic: boolean) =>
    request<SearchHit[]>(
      `/api/functions/${key}/search?q=${encodeURIComponent(q)}` +
        (semantic ? "&semantic=true" : ""),
    ),
  // Free-form folders within a function (paths are function-relative)
  functionFolders: (key: string) =>
    request<string[]>(`/api/functions/${key}/folders`),
  createFolder: (key: string, parent: string, name: string) =>
    request<string[]>(`/api/functions/${key}/folders`, {
      method: "POST",
      body: JSON.stringify({ parent, name }),
    }),
  deleteFolder: (key: string, path: string) =>
    request<FileOpResult>(
      `/api/functions/${key}/folders?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  uploadFunctionDoc: (key: string, file: File, dir?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (dir) fd.append("dir", dir);
    return request<TimelineNode>(`/api/functions/${key}/documents`, {
      method: "POST",
      body: fd,
    });
  },
  deleteFunctionDoc: (key: string, documentId: string) =>
    request<void>(`/api/functions/${key}/documents/${documentId}`, {
      method: "DELETE",
    }),

  // Projects + tasks
  listProjects: () => request<Project[]>("/api/projects"),
  getProject: (projectId: string) =>
    request<Project>(`/api/projects/${projectId}`),
  createProject: (body: ProjectIn) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProject: (projectId: string, body: ProjectUpdate) =>
    request<Project>(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listTasks: (projectId: string) =>
    request<Task[]>(`/api/projects/${projectId}/tasks`),
  createTask: (
    projectId: string,
    body: { title: string; due_date?: string | null; kind?: string },
  ) =>
    request<Task>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Persisted conversation (project_id null = global context)
  getMessages: (agentId: string, projectId: string | null) =>
    request<Message[]>(
      `/api/agents/${agentId}/messages` +
        (projectId ? `?project_id=${projectId}` : ""),
    ),
  sendMessage: (agentId: string, body: SendMessageIn) =>
    request<Message[]>(`/api/agents/${agentId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteMessage: (agentId: string, messageId: string) =>
    request<void>(`/api/agents/${agentId}/messages/${messageId}`, {
      method: "DELETE",
    }),

  // Project/stream timeline (files + action items), optional facet filter
  projectTimeline: (projectId: string, facet?: string | null) =>
    request<TimelineNode[]>(
      `/api/projects/${projectId}/timeline` +
        (facet ? `?facet=${encodeURIComponent(facet)}` : ""),
    ),
  // The container's controlled facet vocabulary (for filter chips)
  projectFacets: (projectId: string) =>
    request<string[]>(`/api/projects/${projectId}/facets`),
  // Attach/clear a note (URL/text) on a timeline item (task:/doc:/file:)
  setTimelineNote: (projectId: string, nodeId: string, note: string | null) =>
    request<void>(`/api/projects/${projectId}/timeline/note`, {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId, note }),
    }),
  // Move a timeline item to a different day (task due_date / doc occurred_at)
  setTimelineDate: (projectId: string, nodeId: string, date: string) =>
    request<void>(`/api/projects/${projectId}/timeline/date`, {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId, date }),
    }),
  // Container-scoped file search (keyword always; semantic on toggle)
  searchContainer: (projectId: string, q: string, semantic: boolean) =>
    request<SearchHit[]>(
      `/api/projects/${projectId}/search?q=${encodeURIComponent(q)}` +
        (semantic ? "&semantic=true" : ""),
    ),

  // File read access (preview + download). Raw is a same-origin URL usable
  // directly as <img>/<iframe>/<a download> src; text is the extracted text.
  fileRawUrl: (path: string) =>
    `${BASE}/api/files/raw?path=${encodeURIComponent(path)}`,
  fileText: (path: string) =>
    request<{ text: string | null }>(
      `/api/files/text?path=${encodeURIComponent(path)}`,
    ),
  renameFile: (path: string, newName: string) =>
    request<FileOpResult>("/api/files/rename", {
      method: "POST",
      body: JSON.stringify({ path, new_name: newName }),
    }),
  moveFile: (path: string, targetDir: string) =>
    request<FileOpResult>("/api/files/move", {
      method: "POST",
      body: JSON.stringify({ path, target_dir: targetDir }),
    }),
  deleteFile: (path: string) =>
    request<FileOpResult>(`/api/files?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),

  // Task (action-item) attachments
  listTaskDocs: (projectId: string, taskId: string) =>
    request<TaskDoc[]>(`/api/projects/${projectId}/tasks/${taskId}/documents`),
  uploadTaskDoc: (projectId: string, taskId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<TaskDoc>(
      `/api/projects/${projectId}/tasks/${taskId}/documents`,
      { method: "POST", body: fd },
    );
  },
  linkTaskDoc: (projectId: string, taskId: string, path: string) =>
    request<TaskDoc>(`/api/projects/${projectId}/tasks/${taskId}/documents/link`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  unlinkTaskDoc: (projectId: string, taskId: string, docId: string) =>
    request<void>(
      `/api/projects/${projectId}/tasks/${taskId}/documents/${docId}`,
      { method: "DELETE" },
    ),
  listContainerFiles: (projectId: string) =>
    request<ContainerFile[]>(`/api/projects/${projectId}/files`),
  // Drop a file onto a project's timeline (.eml dated by its sent/received header)
  uploadDocument: (projectId: string, file: File, dir?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (dir) fd.append("dir", dir);
    return request<TimelineNode>(`/api/projects/${projectId}/documents`, {
      method: "POST",
      body: fd,
    });
  },
  // Project filesystem (mirrors the function folder endpoints)
  projectTree: (projectId: string) =>
    request<FsTreeNode>(`/api/projects/${projectId}/tree`),
  projectFolders: (projectId: string) =>
    request<string[]>(`/api/projects/${projectId}/folders`),
  createProjectFolder: (projectId: string, parent: string, name: string) =>
    request<string[]>(`/api/projects/${projectId}/folders`, {
      method: "POST",
      body: JSON.stringify({ parent, name }),
    }),
  deleteProjectFolder: (projectId: string, path: string) =>
    request<FileOpResult>(
      `/api/projects/${projectId}/folders?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  deleteDocument: (projectId: string, documentId: string) =>
    request<void>(`/api/projects/${projectId}/documents/${documentId}`, {
      method: "DELETE",
    }),
  deleteTask: (projectId: string, taskId: string) =>
    request<void>(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: "DELETE",
    }),

  // Approval queue
  listApprovals: () => request<ProposalRecord[]>("/api/approvals"),
  approveProposal: (id: string) =>
    request<ProposalRecord>(`/api/approvals/${id}/approve`, { method: "POST" }),
  rejectProposal: (id: string) =>
    request<ProposalRecord>(`/api/approvals/${id}/reject`, { method: "POST" }),
};
