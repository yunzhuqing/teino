export interface ActionState {
  ok?: boolean;
  error?: string;
  /** 仅展示一次的机密信息（如新建的 API Key） */
  secret?: string;
  /** 每次提交递增，用于客户端识别新结果 */
  ts?: number;
}

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
