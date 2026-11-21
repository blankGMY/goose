import { methods, type ContentBlock, type PromptResponse } from '@agentclientprotocol/sdk/unstable';
import type {
  SteerSessionRequest_unstable,
  SteerSessionResponse_unstable,
} from '@aaif/goose-acp-client';
import type { Message } from '../types/message';
import { getAcpClient } from './acpConnection';
import {
  getPcWorkspace,
  markPcWorkspaceBriefed,
  pcWorkspaceBriefing,
} from './pcWorkspace';

export async function acpPromptSession(
  sessionId: string,
  message: Message
): Promise<PromptResponse> {
  const client = await getAcpClient();
  // If this session has a PC workspace the agent has not been briefed
  // about yet (new session, or the folder changed), prefix the briefing
  // so the agent works in that folder via the windows extension.
  const entry = getPcWorkspace(sessionId);
  let outgoing = message;
  let briefingPath: string | null = null;
  if (entry && entry.briefedPath !== entry.path) {
    briefingPath = entry.path;
    const briefing = pcWorkspaceBriefing(entry.path);
    const content = [...message.content];
    const idx = content.findIndex((c) => c.type === 'text');
    if (idx >= 0) {
      const block = content[idx] as { type: 'text'; text: string };
      content[idx] = { ...block, text: `${briefing}\n${block.text}` };
    } else {
      content.unshift({ type: 'text', text: briefing } as Message['content'][number]);
    }
    outgoing = { ...message, content };
  }
  const response = await client.connection.agent.request(methods.agent.session.prompt, {
    sessionId,
    prompt: messageToAcpPromptContent(outgoing),
  });
  if (briefingPath) {
    markPcWorkspaceBriefed(sessionId);
  }
  return response;
}

export async function acpCancelPrompt(sessionId: string): Promise<void> {
  const client = await getAcpClient();
  await client.connection.agent.notify(methods.agent.session.cancel, { sessionId });
}

export async function acpSteerSession(
  sessionId: string,
  message: Message,
  expectedRunId: string
): Promise<SteerSessionResponse_unstable> {
  const client = await getAcpClient();
  return client.goose.sessionSteer_unstable({
    sessionId,
    expectedRunId,
    prompt: messageToAcpPromptContent(message) as unknown as SteerSessionRequest_unstable['prompt'],
  });
}

export function messageToAcpPromptContent(message: Message): ContentBlock[] {
  const prompt: ContentBlock[] = [];

  for (const content of message.content) {
    switch (content.type) {
      case 'text':
        if (content.text.trim()) {
          prompt.push({
            type: 'text',
            text: content.text,
          });
        }
        break;
      case 'image':
        prompt.push({
          type: 'image',
          data: content.data,
          mimeType: content.mimeType,
          ...(content._meta ? { _meta: content._meta } : {}),
          ...(content.annotations ? { annotations: content.annotations } : {}),
        });
        break;
    }
  }

  return prompt;
}
