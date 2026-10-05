import type { ApiType } from "../../db/schema";
import { anthropicCodec } from "./anthropic";
import { openaiChatCodec } from "./openai-chat";
import { openaiResponsesCodec } from "./openai-responses";
import type { Codec } from "./shared";

export const CODECS: Record<ApiType, Codec> = {
  openai_chat: openaiChatCodec,
  openai_responses: openaiResponsesCodec,
  anthropic_messages: anthropicCodec,
};

export type { Codec, EncodeContext } from "./shared";
export { extractErrorMessage, UpstreamStreamError } from "./shared";
