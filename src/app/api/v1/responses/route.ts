import { handleGatewayRequest } from "@/lib/gateway/handler";

export const maxDuration = 300;

export function POST(req: Request) {
  return handleGatewayRequest(req, "openai_responses");
}
