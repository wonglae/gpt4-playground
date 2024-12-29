import _ from "lodash";
import { OpenAIChatMessage, OpenAIConfig } from "./OpenAI.types";
import {
  createParser,
  ParsedEvent,
  ReconnectInterval,
} from "eventsource-parser";

export const defaultConfig = {
  model: "gpt-3.5-turbo",
  temperature: 0.5,
  max_tokens: 2048,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0.6,
};

export type OpenAIRequest = {
  messages: OpenAIChatMessage[];
  tools?: string,
  tool_choice?: string;
} & OpenAIConfig;

export const getOpenAICompletion = async (
  token: string,
  payload: OpenAIRequest
) => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  payload.messages = payload.messages.map((message) => {
    try {
      if (message.role !== "assistant" && message.role !== "tool") {
        return message;
      }
      const obj = JSON.parse(message.content);
      return {
        role: message.role,
        ...obj,
      };
    } catch (error) {
      return message;
    };
  });

  // console.log('payload', JSON.stringify(payload), '\n');
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify(payload),
  });

  // Check for errors
  if (!response.ok) {
    const error = await response.text();
    console.log('error', error, '\n');
    throw new Error(error);
  }

  let counter = 0;
  let tool_calls_chunk: any = [];
  const stream = new ReadableStream({
    async start(controller) {
      function onParse(event: ParsedEvent | ReconnectInterval) {
        if (event.type === "event") {
          const data = event.data;
          // console.log('data', JSON.stringify(JSON.parse(data), null, "\t"), '\n');
          // https://beta.openai.com/docs/api-reference/completions/create#completions/create-stream
          if (data === "[DONE]") {
            if (tool_calls_chunk.length > 0) {
              console.log('tool_calls_chunk', JSON.stringify({ tool_calls: tool_calls_chunk }, null, "\t"), '\n');
              const queue = encoder.encode(JSON.stringify({ tool_calls: tool_calls_chunk }, null, "\t"));
              controller.enqueue(queue);
            }
            controller.close();
            return;
          }

          try {
            const json = JSON.parse(data);
            if (!json.choices || json.choices.length === 0) {
              return;
            }
            const delta_chunk = json.choices[0].delta;
            const text = delta_chunk?.content;
            if (text) {
              if (counter < 2 && (text.match(/\n/) || []).length) {
                return;
              }
              const queue = encoder.encode(text);
              controller.enqueue(queue);
              counter++;
            }
            if (delta_chunk.tool_calls) {
              const tool_call_chunk_index = tool_calls_chunk.findIndex((f: { index: any; }) => f.index === delta_chunk.tool_calls[0].index);
              if (tool_call_chunk_index >= 0) {
                console.log('data1', JSON.stringify(tool_calls_chunk[tool_call_chunk_index], null, "\t"), '\n');
                tool_calls_chunk[tool_call_chunk_index] = _.mergeWith(tool_calls_chunk[tool_call_chunk_index], delta_chunk.tool_calls[0], (objValue: any, srcValue: any) => {
                  if (typeof (objValue) === 'string') {
                    return objValue + srcValue;
                  }
                  return undefined;
                });
                console.log('data2', JSON.stringify(delta_chunk.tool_calls[0], null, "\t"), '\n');
                console.log('data3', JSON.stringify(tool_calls_chunk[tool_call_chunk_index], null, "\t"), '\n');
              } else {
                tool_calls_chunk.push(delta_chunk.tool_calls[0]);
              }
            }
          } catch (e) {
            controller.error(e);
          }
        }
      }

      const parser = createParser(onParse);
      for await (const chunk of response.body as any) {
        parser.feed(decoder.decode(chunk));
      }
    },
  });

  return stream;
};
